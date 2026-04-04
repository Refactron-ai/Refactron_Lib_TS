// src/cli/components/IssueBrowser.tsx
// Interactive issue browser — the central hub for the analyze→fix pipeline.
//
// Layout:
//   header bar  — session id, counts, filter hint
//   ─ separator
//   issue list  — paginated, ↑↓/j/k navigation, selected row highlighted
//   ─ separator
//   detail panel — message, suggestion, file, status / diff preview
//   ─ separator
//   footer hints — contextual keybindings
//
// Keys:
//   ↑↓  /  j k    navigate
//   a              fix selected issue (writes file, stays in browser)
//   A              fix ALL fixable issues in one pass
//   d              dry-run selected issue (shows diff in detail panel)
//   v              verify selected file
//   /              enter filter mode (type to filter by message or file)
//   Esc            clear filter / exit filter mode / dismiss diff
//   q              exit browser
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import fs from 'fs/promises';
import { theme } from '../../ui/theme.js';
import { AutoFixEngine } from '../../autofix/engine.js';
import { VerificationEngine } from '../../verification/engine.js';
import { BackupManager } from '../../infrastructure/backup.js';
import { atomicWrite } from '../../verification/atomic-writer.js';
import type { CodeIssue, Severity } from '../../core/models.js';
import type { ILanguageAdapter } from '../../adapters/interface.js';
import type { RefactronConfig } from '../../core/config.js';

const SEV_COLOR: Record<Severity, string> = {
  critical: theme.colors.critical,
  high:     theme.colors.high,
  medium:   theme.colors.medium,
  low:      theme.colors.low,
};

const SEV_LABEL: Record<Severity, string> = {
  critical: 'CRIT',
  high:     'HIGH',
  medium:   'MED ',
  low:      'LOW ',
};

interface IssueBrowserProps {
  issues: CodeIssue[];
  sessionId: string;
  projectRoot: string;
  adapter: ILanguageAdapter;
  config: RefactronConfig;
  onExit: (fixedFiles: string[]) => void;
}

interface StatusEntry {
  text: string;
  color: string;
  id: number;
}

let statusSeq = 0;

export function IssueBrowser({
  issues,
  sessionId,
  projectRoot,
  adapter,
  config: _config,
  onExit,
}: IssueBrowserProps): React.ReactElement {
  const { stdout } = useStdout();
  const columns = stdout?.columns ?? 80;
  const rows = stdout?.rows ?? 24;

  // ── State ──────────────────────────────────────────────────────────────
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [filterMode, setFilterMode] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [fixedIds, setFixedIds] = useState<Set<string>>(new Set());
  const [fixedFiles, setFixedFiles] = useState<Set<string>>(new Set());
  const [verifiedFiles, setVerifiedFiles] = useState<Map<string, boolean>>(new Map());
  const [status, setStatus] = useState<StatusEntry | null>(null);
  const [diffLines, setDiffLines] = useState<string[] | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [workingLabel, setWorkingLabel] = useState('');
  const [hintIdx, setHintIdx] = useState(0);

  // ── Auto-dismiss status after 3s ──────────────────────────────────────
  useEffect(() => {
    if (!status) return;
    const id = status.id;
    const t = setTimeout(() => setStatus((s) => (s?.id === id ? null : s)), 3000);
    return () => clearTimeout(t);
  }, [status]);

  const pushStatus = useCallback((text: string, color: string = theme.colors.textDim) => {
    setStatus({ text, color, id: ++statusSeq });
  }, []);

  // ── Rotating hints — rebuild when state changes, cycle every 3.5s ─────
  const hints = useMemo(() => {
    const hasAnyFixed = fixedIds.size > 0;
    const fixedNotVerified = [...fixedIds].some((id) => {
      const issue = issues.find((i) => i.id === id);
      return issue && !verifiedFiles.has(issue.file);
    });
    const hasBlocked = [...verifiedFiles.values()].some((v) => !v);
    const allVerifiedSafe = hasAnyFixed && !fixedNotVerified && !hasBlocked;
    const unfixedCount = issues.filter((i) => i.fixable && !fixedIds.has(i.id)).length;

    const list: Array<{ text: string; color?: string; highlight?: string }> = [];

    if (allVerifiedSafe) {
      list.push({ text: '✔ All fixed issues verified safe — press ', highlight: 'q', color: theme.colors.success });
      list.push({ text: 'Changes are written to disk. Press ', highlight: 'q to exit', color: theme.colors.success });
    } else if (hasBlocked) {
      list.push({ text: '✘ Blocked issues found — press ', highlight: 'q', color: theme.colors.error });
      list.push({ text: 'Run ', highlight: 'rollback', color: theme.colors.error });
      list.push({ text: 'To undo all applied fixes, quit and run rollback', color: theme.colors.error });
    } else if (fixedNotVerified) {
      list.push({ text: 'Fixed but not verified — navigate to a ✔ issue and press ', highlight: 'v' });
      list.push({ text: 'Verification checks blast radius before marking safe', });
      list.push({ text: 'After verifying, press ', highlight: 'q to exit' });
    } else if (unfixedCount > 0) {
      list.push({ text: 'Press ', highlight: 'a', });
      list.push({ text: 'Press ', highlight: 'd', });
      list.push({ text: 'Press ', highlight: 'A to fix all ' + String(unfixedCount) + ' fixable issues at once' });
      list.push({ text: '/ to filter by filename, message, or severity' });
      list.push({ text: 'j / k or ↑ / ↓ to navigate · g / G to jump first/last' });
    }

    // Always include navigation reminder when list is getting long
    if (list.length === 0) {
      list.push({ text: 'No fixable issues — press ', highlight: 'q to exit' });
    }

    return list;
  }, [fixedIds, verifiedFiles, issues]);

  // Advance hint index on interval, reset when hints change
  useEffect(() => {
    setHintIdx(0);
  }, [hints]);

  useEffect(() => {
    if (hints.length <= 1) return;
    const t = setInterval(() => setHintIdx((i) => (i + 1) % hints.length), 3500);
    return () => clearInterval(t);
  }, [hints.length]);

  const currentHint = hints[hintIdx % hints.length];

  // ── Filtered list ──────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    if (!filterText) return issues;
    const q = filterText.toLowerCase();
    return issues.filter(
      (i) =>
        i.message.toLowerCase().includes(q) ||
        i.file.toLowerCase().includes(q) ||
        i.severity.includes(q) ||
        i.type.toLowerCase().includes(q),
    );
  }, [issues, filterText]);

  const clampedIdx = Math.min(selectedIdx, Math.max(0, filtered.length - 1));
  const selected = filtered[clampedIdx] ?? null;

  // Page: how many issue rows fit
  const HEADER_ROWS = 3; // header + sep + column labels
  const DETAIL_ROWS = 6; // sep + 4 detail lines + sep
  const FOOTER_ROWS = 2; // footer + status
  const pageSize = Math.max(4, rows - HEADER_ROWS - DETAIL_ROWS - FOOTER_ROWS);
  const pageStart = Math.max(0, Math.min(
    clampedIdx - Math.floor(pageSize / 2),
    Math.max(0, filtered.length - pageSize),
  ));
  const pageEnd = Math.min(filtered.length, pageStart + pageSize);
  const pageIssues = filtered.slice(pageStart, pageEnd);

  // ── Fix a single issue ─────────────────────────────────────────────────
  const fixIssue = useCallback(
    async (issue: CodeIssue, dry: boolean) => {
      if (isWorking) return;
      if (!issue.fixable) {
        pushStatus('  Not auto-fixable.', theme.colors.warning);
        setDiffLines(null);
        return;
      }
      setIsWorking(true);
      setWorkingLabel(dry ? 'dry-run' : 'fixing');
      setDiffLines(null);
      try {
        const engine = new AutoFixEngine();
        const code = await fs.readFile(issue.file, 'utf-8');
        const transform = await engine.fix(issue.file, code, issue);
        if (!transform) {
          pushStatus('  No transform produced.', theme.colors.warning);
          setIsWorking(false);
          setWorkingLabel('');
          return;
        }
        if (dry) {
          const diff = adapter.generateDiff(code, transform.transformedCode);
          const lines = diff.split('\n');
          setDiffLines(lines.slice(0, 12));
          pushStatus('  Dry-run preview — nothing written.', theme.colors.textDim);
        } else {
          const backup = new BackupManager(projectRoot);
          await backup.backup(issue.file);
          await atomicWrite(issue.file, transform.transformedCode);
          setFixedIds((prev) => new Set([...prev, issue.id]));
          setFixedFiles((prev) => new Set([...prev, issue.file]));
          const name = issue.file.split('/').pop() ?? issue.file;
          pushStatus(`  ✔ Fixed ${name}:${issue.line}`, theme.colors.success);
        }
      } catch (err) {
        pushStatus(`  Error: ${String(err)}`, theme.colors.error);
      }
      setIsWorking(false);
      setWorkingLabel('');
    },
    [isWorking, adapter, projectRoot, pushStatus],
  );

  // ── Fix ALL fixable issues in filtered list ────────────────────────────
  const fixAll = useCallback(async () => {
    if (isWorking) return;
    const fixable = filtered.filter((i) => i.fixable && !fixedIds.has(i.id));
    if (fixable.length === 0) {
      pushStatus('  No unfixed fixable issues.', theme.colors.warning);
      return;
    }
    setIsWorking(true);
    setWorkingLabel(`fixing 0/${fixable.length}`);
    setDiffLines(null);
    const engine = new AutoFixEngine();
    const backup = new BackupManager(projectRoot);
    let applied = 0;
    let failed = 0;
    const newFixedIds = new Set(fixedIds);
    const newFixedFiles = new Set(fixedFiles);
    for (let i = 0; i < fixable.length; i++) {
      const issue = fixable[i]!;
      setWorkingLabel(`fixing ${i + 1}/${fixable.length}`);
      try {
        const code = await fs.readFile(issue.file, 'utf-8');
        const transform = await engine.fix(issue.file, code, issue);
        if (transform) {
          await backup.backup(issue.file);
          await atomicWrite(issue.file, transform.transformedCode);
          newFixedIds.add(issue.id);
          newFixedFiles.add(issue.file);
          applied++;
        }
      } catch {
        failed++;
      }
    }
    setFixedIds(newFixedIds);
    setFixedFiles(newFixedFiles);
    pushStatus(
      `  ✔ Fixed ${applied}/${fixable.length}${failed > 0 ? `  (${failed} failed)` : ''}`,
      applied > 0 ? theme.colors.success : theme.colors.warning,
    );
    setIsWorking(false);
    setWorkingLabel('');
  }, [isWorking, filtered, fixedIds, fixedFiles, projectRoot, pushStatus]);

  // ── Verify selected file ───────────────────────────────────────────────
  const verifyFile = useCallback(
    async (issue: CodeIssue) => {
      if (isWorking) return;
      setIsWorking(true);
      setWorkingLabel('verifying');
      setDiffLines(null);
      try {
        const verEngine = new VerificationEngine(adapter);
        const code = await fs.readFile(issue.file, 'utf-8');
        const maxBlast = filtered
          .filter((i) => i.file === issue.file)
          .reduce((max, i) => (i.blastRadius.score > max.score ? i.blastRadius : max), issue.blastRadius);
        const result = await verEngine.verify(issue.file, code, maxBlast);
        setVerifiedFiles((prev) => new Map([...prev, [issue.file, result.safeToApply]]));
        const conf = `${Math.round(result.confidenceScore * 100)}%`;
        if (result.safeToApply) {
          pushStatus(`  ✔ Safe to apply  (confidence: ${conf})`, theme.colors.success);
        } else {
          pushStatus(`  ✘ Blocked — ${result.blockingReason ?? 'verification failed'}  (${conf})`, theme.colors.error);
        }
      } catch (err) {
        pushStatus(`  Error: ${String(err)}`, theme.colors.error);
      }
      setIsWorking(false);
      setWorkingLabel('');
    },
    [isWorking, adapter, filtered, pushStatus],
  );

  // ── Input ──────────────────────────────────────────────────────────────
  useInput(
    (inputChar, key) => {
      if (isWorking) return;

      // Filter mode — typing
      if (filterMode) {
        if (key.return || key.escape) {
          setFilterMode(false);
          return;
        }
        if (key.backspace || key.delete) {
          setFilterText((t) => t.slice(0, -1));
          return;
        }
        if (!key.ctrl && !key.meta && inputChar && inputChar.length > 0) {
          setFilterText((t) => t + inputChar);
          setSelectedIdx(0);
        }
        return;
      }

      // Navigation — arrows + vim j/k
      if (key.upArrow || inputChar === 'k') {
        setSelectedIdx((i) => Math.max(0, i - 1));
        setDiffLines(null);
        return;
      }
      if (key.downArrow || inputChar === 'j') {
        setSelectedIdx((i) => Math.min(filtered.length - 1, i + 1));
        setDiffLines(null);
        return;
      }

      // Page up/down
      if (key.pageUp) {
        setSelectedIdx((i) => Math.max(0, i - pageSize));
        setDiffLines(null);
        return;
      }
      if (key.pageDown) {
        setSelectedIdx((i) => Math.min(filtered.length - 1, i + pageSize));
        setDiffLines(null);
        return;
      }

      // Jump to first/last
      if (inputChar === 'g') {
        setSelectedIdx(0);
        setDiffLines(null);
        return;
      }
      if (inputChar === 'G') {
        setSelectedIdx(Math.max(0, filtered.length - 1));
        setDiffLines(null);
        return;
      }

      // Fix selected
      if (inputChar === 'a' && selected) {
        void fixIssue(selected, false);
        return;
      }

      // Fix all
      if (inputChar === 'A') {
        void fixAll();
        return;
      }

      // Dry-run selected
      if (inputChar === 'd' && selected) {
        void fixIssue(selected, true);
        return;
      }

      // Verify selected file — only if already fixed
      if (inputChar === 'v' && selected) {
        if (!fixedIds.has(selected.id)) {
          pushStatus('  Fix this issue first before verifying.', theme.colors.warning);
          return;
        }
        void verifyFile(selected);
        return;
      }

      // Dismiss diff / clear filter
      if (key.escape) {
        if (diffLines) { setDiffLines(null); return; }
        if (filterText) { setFilterText(''); return; }
        return;
      }

      // Enter filter mode
      if (inputChar === '/') {
        setFilterMode(true);
        setFilterText('');
        return;
      }

      // Quit
      if (inputChar === 'q') {
        onExit([...fixedFiles]);
        return;
      }
    },
    { isActive: process.stdin.isTTY === true },
  );

  // ── Render helpers ─────────────────────────────────────────────────────
  const border = '─'.repeat(columns);
  const fixableTotal = issues.filter((i) => i.fixable).length;
  const fixedCount = fixedIds.size;
  const msgWidth = Math.max(20, columns - 44);

  return (
    <Box flexDirection="column">
      {/* ── Header ────────────────────────────────────────────────────── */}
      <Box>
        <Text color={theme.colors.brand} bold>{' Issues '}</Text>
        <Text dimColor>
          {'session '}{sessionId}
          {' · '}{filtered.length}{filterText ? ` of ${issues.length}` : ''}{' issues'}
          {' · '}{fixableTotal}{' fixable'}
          {fixedCount > 0 && <Text color={theme.colors.success}>{` · ${fixedCount} fixed`}</Text>}
        </Text>
        <Text dimColor>{'  '}</Text>
        {isWorking ? (
          <Text color={theme.colors.warning}>{workingLabel}…</Text>
        ) : filterMode ? (
          <Text color={theme.colors.brand}>{'/ '}{filterText}<Text color={theme.colors.brand}>█</Text></Text>
        ) : filterText ? (
          <Text dimColor>{'filter: '}<Text color={theme.colors.brand}>{filterText}</Text><Text dimColor>{'  Esc clear'}</Text></Text>
        ) : (
          <Text dimColor>{'/ filter · q quit'}</Text>
        )}
      </Box>
      <Text color={theme.colors.border}>{border}</Text>

      {/* ── Column labels ─────────────────────────────────────────────── */}
      <Box paddingLeft={1}>
        <Text dimColor>{'  #   SEV  '}</Text>
        <Text dimColor>{'MESSAGE'.padEnd(msgWidth + 2)}</Text>
        <Text dimColor>{'FILE:LINE'}</Text>
      </Box>

      {/* ── Issue rows ────────────────────────────────────────────────── */}
      {filtered.length === 0 && (
        <Box paddingLeft={2} paddingTop={1}>
          <Text dimColor>No issues match filter.</Text>
        </Box>
      )}
      {pageIssues.map((issue, i) => {
        const globalIdx = pageStart + i;
        const isSelected = globalIdx === clampedIdx;
        const isFixed = fixedIds.has(issue.id);
        const verStatus = verifiedFiles.get(issue.file);
        const rel = issue.file.replace(projectRoot + '/', '').split('/').slice(-2).join('/');
        const msg = issue.message.slice(0, msgWidth).padEnd(msgWidth);

        // Fix/verify mark
        let fixMark: string;
        let fixColor: string;
        if (isFixed) {
          fixMark = '✔';
          fixColor = theme.colors.success;
        } else if (verStatus === false) {
          fixMark = '✘';
          fixColor = theme.colors.error;
        } else if (verStatus === true) {
          fixMark = '✓';
          fixColor = theme.colors.success;
        } else if (issue.fixable) {
          fixMark = '·';
          fixColor = theme.colors.brand;
        } else {
          fixMark = ' ';
          fixColor = theme.colors.textDim;
        }

        return (
          <Box key={issue.id}>
            {isSelected ? (
              <Text color={theme.colors.brand}>{'▶'}</Text>
            ) : (
              <Text>{' '}</Text>
            )}
            <Text color={isSelected ? theme.colors.brand : theme.colors.textDim}>
              {String(globalIdx + 1).padStart(4)}{'  '}
            </Text>
            <Text color={SEV_COLOR[issue.severity]} bold={isSelected}>
              {SEV_LABEL[issue.severity]}{'  '}
            </Text>
            <Text color={isSelected ? theme.colors.text : theme.colors.textDim}>
              {msg}{'  '}
            </Text>
            <Text dimColor>{rel}:{issue.line}{'  '}</Text>
            <Text color={fixColor}>{fixMark}</Text>
          </Box>
        );
      })}

      {/* Scroll position indicator */}
      {filtered.length > pageSize && (
        <Box paddingLeft={2}>
          <Text dimColor>
            {'  '}{pageStart + 1}{'–'}{pageEnd}{' of '}{filtered.length}
            {'  ↑↓/jk navigate · g/G jump · PgUp/PgDn page'}
          </Text>
        </Box>
      )}

      {/* ── Detail panel ──────────────────────────────────────────────── */}
      <Text color={theme.colors.border}>{border}</Text>
      {selected ? (
        <Box flexDirection="column" paddingLeft={2}>
          {diffLines ? (
            <>
              <Text dimColor>{'Diff preview (Esc to dismiss):'}</Text>
              {diffLines.map((line, i) => {
                const color = line.startsWith('+') ? theme.colors.diffAdded
                  : line.startsWith('-') ? theme.colors.diffRemoved
                  : theme.colors.textDim;
                return <Text key={i} color={color}>{line || ' '}</Text>;
              })}
            </>
          ) : (
            <>
              <Text>
                <Text dimColor>{'Msg:  '}</Text>
                <Text color={theme.colors.text}>{selected.message.slice(0, columns - 10)}</Text>
              </Text>
              {selected.suggestion && (
                <Text>
                  <Text dimColor>{'Fix:  '}</Text>
                  <Text color={theme.colors.text}>{selected.suggestion.slice(0, columns - 10)}</Text>
                </Text>
              )}
              <Text>
                <Text dimColor>{'File: '}</Text>
                <Text dimColor>{selected.file.replace(projectRoot + '/', '')}:{selected.line}</Text>
                <Text dimColor>{'  blast:'}{selected.blastRadius.level}</Text>
                {selected.fixable ? (
                  <Text color={theme.colors.success}>{' [fixable]'}</Text>
                ) : (
                  <Text dimColor>{' [manual]'}</Text>
                )}
                {fixedIds.has(selected.id) && <Text color={theme.colors.success}>{' ✔ fixed'}</Text>}
                {verifiedFiles.has(selected.file) && (
                  verifiedFiles.get(selected.file)
                    ? <Text color={theme.colors.success}>{' ✓ safe'}</Text>
                    : <Text color={theme.colors.error}>{' ✘ blocked'}</Text>
                )}
              </Text>
            </>
          )}
        </Box>
      ) : (
        <Box paddingLeft={2}>
          <Text dimColor>No issue selected.</Text>
        </Box>
      )}

      {/* Status message (auto-dismisses after 3s) */}
      {status && (
        <Box paddingLeft={2}>
          <Text color={status.color}>{status.text}</Text>
        </Box>
      )}

      <Text color={theme.colors.border}>{border}</Text>


      {/* ── Footer ────────────────────────────────────────────────────── */}
      <Box paddingLeft={1}>
        {isWorking ? (
          <Text color={theme.colors.warning}>{workingLabel}… please wait</Text>
        ) : filterMode ? (
          <Text dimColor>{'Type to filter · Enter/Esc to confirm'}</Text>
        ) : (
          <Text dimColor>
            {'↑↓ nav · '}
            <Text color={theme.colors.brand}>{'a'}</Text>{' fix · '}
            <Text color={theme.colors.brand}>{'A'}</Text>{' fix all · '}
            <Text color={theme.colors.brand}>{'d'}</Text>{' dry-run · '}
            <Text color={theme.colors.brand}>{'v'}</Text>{' verify · '}
            <Text color={theme.colors.brand}>{'/'}</Text>{' filter · '}
            <Text color={theme.colors.brand}>{'q'}</Text>{' quit'}
          </Text>
        )}
      </Box>
    </Box>
  );
}
