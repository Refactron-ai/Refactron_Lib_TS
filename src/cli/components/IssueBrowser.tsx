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
import path from 'node:path';
import { theme } from '../../ui/theme.js';
import { RefactronAnalyzer } from '../../analyze/engine.js';
import { RefactronRefactorer } from '../../transform/engine.js';
import { RefactronVerifier } from '../../verify/engine.js';
import { writeBatchAtomic } from '../../verify/atomic-batch-writer.js';
import type { CodeIssue, Severity } from '../../core/models.js';
import type { ILanguageAdapter } from '../../adapters/interface.js';
import type { RefactronConfig } from '../../core/config.js';
import type { TransformId, RefactorPlan } from '../../contracts.js';

const SEV_COLOR: Record<Severity, string> = {
  critical: theme.colors.critical,
  high: theme.colors.high,
  medium: theme.colors.medium,
  low: theme.colors.low,
};

const SEV_LABEL: Record<Severity, string> = {
  critical: 'CRIT',
  high: 'HIGH',
  medium: 'MED ',
  low: 'LOW ',
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
  const pageStart = Math.max(
    0,
    Math.min(clampedIdx - Math.floor(pageSize / 2), Math.max(0, filtered.length - pageSize)),
  );
  const pageEnd = Math.min(filtered.length, pageStart + pageSize);
  const pageIssues = filtered.slice(pageStart, pageEnd);

  // Helper: re-analyze and build a RefactorPlan scoped to the requested files + transforms.
  // The v2 engines operate per-file; we always re-analyze for fresh cross-file context.
  const buildPlan = useCallback(
    async (files: Set<string>, transforms: TransformId[]): Promise<RefactorPlan> => {
      const analyzer = new RefactronAnalyzer({ confidence: 'low' });
      const report = await analyzer.analyzeExtended(projectRoot);
      const filteredReport = {
        ...report,
        findings: report.findings.filter((f) => files.has(f.file)),
      };
      const refactorer = new RefactronRefactorer({ projectRoot });
      return refactorer.plan(filteredReport, transforms);
    },
    [projectRoot],
  );

  // ── Fix a single issue ─────────────────────────────────────────────────
  // 'a' applies one finding's transform to its file via the v2 pipeline:
  // analyze → plan → 3-gate verify → atomic write. 'd' previews the diff
  // by stopping after plan.
  const fixIssue = useCallback(
    async (issue: CodeIssue, dry: boolean) => {
      if (isWorking) return;
      setIsWorking(true);
      setWorkingLabel(dry ? 'planning' : 'fixing');
      setDiffLines(null);
      try {
        const transformId = (issue.fixerName ?? issue.type) as TransformId;
        const plan = await buildPlan(new Set([issue.file]), [transformId]);
        if (plan.changes.length === 0) {
          const skip = plan.preconditions.find((p) => !p.satisfied);
          const msg = skip?.reason
            ? `Skipped — ${skip.reason}.`
            : `No diff produced — the v2 transform may not yet handle this finding's context (e.g. nested expression, top-level-only LibCST command). Detector saw a pattern; transform declined to rewrite.`;
          pushStatus(`  ${msg}`, theme.colors.warning);
          setIsWorking(false);
          setWorkingLabel('');
          return;
        }
        const change = plan.changes[0]!;
        if (dry) {
          const original = await fs.readFile(change.path, 'utf-8');
          const diff = adapter.generateDiff(original, change.newContent);
          setDiffLines(diff.split('\n').slice(0, 12));
          pushStatus('  Dry-run preview — nothing written.', theme.colors.textDim);
        } else {
          const verifier = new RefactronVerifier({ projectRoot });
          const result = await verifier.verify(plan);
          if (!result.passed) {
            const failed = Object.entries(result.gates).find(([, g]) => !g.passed);
            pushStatus(
              `  ✘ Verification failed at '${failed?.[0]}' gate. Original untouched.`,
              theme.colors.error,
            );
          } else {
            await writeBatchAtomic(result.writableChanges);
            setFixedIds((prev) => new Set([...prev, issue.id]));
            setFixedFiles((prev) => new Set([...prev, change.path]));
            const name = change.path.split('/').pop() ?? change.path;
            pushStatus(`  ✔ Fixed ${name} (3/3 gates passed)`, theme.colors.success);
          }
        }
      } catch (err) {
        pushStatus(`  Error: ${String(err)}`, theme.colors.error);
      }
      setIsWorking(false);
      setWorkingLabel('');
    },
    [isWorking, adapter, projectRoot, pushStatus, buildPlan],
  );

  // ── Fix ALL fixable issues in filtered list ────────────────────────────
  // 'A' bundles every unfixed finding in the current filter into one plan,
  // verifies once, and atomically writes all-or-nothing.
  const fixAll = useCallback(async () => {
    if (isWorking) return;
    const fixable = filtered.filter((i) => !fixedIds.has(i.id));
    if (fixable.length === 0) {
      pushStatus('  No unfixed issues.', theme.colors.warning);
      return;
    }
    setIsWorking(true);
    setWorkingLabel(`fixing ${fixable.length}`);
    setDiffLines(null);
    try {
      const files = new Set(fixable.map((i) => i.file));
      const transforms = [...new Set(fixable.map((i) => (i.fixerName ?? i.type) as TransformId))];
      const plan = await buildPlan(files, transforms);
      if (plan.changes.length === 0) {
        pushStatus(
          '  All findings skipped (cross-file preconditions or no diff).',
          theme.colors.warning,
        );
      } else {
        const verifier = new RefactronVerifier({ projectRoot });
        const result = await verifier.verify(plan);
        if (!result.passed) {
          const failed = Object.entries(result.gates).find(([, g]) => !g.passed);
          pushStatus(
            `  ✘ Verification failed at '${failed?.[0]}' gate. Nothing written.`,
            theme.colors.error,
          );
        } else {
          await writeBatchAtomic(result.writableChanges);
          const writtenAbs = new Set(result.writableChanges.map((c) => c.path));
          const newFixedIds = new Set(fixedIds);
          const newFixedFiles = new Set(fixedFiles);
          for (const i of fixable) {
            if (writtenAbs.has(path.resolve(projectRoot, i.file))) {
              newFixedIds.add(i.id);
              newFixedFiles.add(i.file);
            }
          }
          setFixedIds(newFixedIds);
          setFixedFiles(newFixedFiles);
          pushStatus(
            `  ✔ Refactored ${result.writableChanges.length} file(s) — ${plan.changes.length} planned, ${plan.preconditions.filter((p) => !p.satisfied).length} skipped.`,
            theme.colors.success,
          );
        }
      }
    } catch (err) {
      pushStatus(`  Error: ${String(err)}`, theme.colors.error);
    }
    setIsWorking(false);
    setWorkingLabel('');
  }, [isWorking, filtered, fixedIds, fixedFiles, projectRoot, pushStatus, buildPlan]);

  // ── Verify selected file ───────────────────────────────────────────────
  // 'v' runs the same 3-gate verifier the apply path uses, but stops before
  // writing — answers "would Refactron be allowed to refactor this file?"
  const verifyFile = useCallback(
    async (issue: CodeIssue) => {
      if (isWorking) return;
      setIsWorking(true);
      setWorkingLabel('verifying');
      setDiffLines(null);
      try {
        const transformsForFile = [
          ...new Set(
            filtered
              .filter((i) => i.file === issue.file)
              .map((i) => (i.fixerName ?? i.type) as TransformId),
          ),
        ];
        const plan = await buildPlan(new Set([issue.file]), transformsForFile);
        if (plan.changes.length === 0) {
          pushStatus(
            `  ${issue.file}: no v2 changes proposed (precondition skipped).`,
            theme.colors.textDim,
          );
        } else {
          const verifier = new RefactronVerifier({ projectRoot });
          const result = await verifier.verify(plan);
          setVerifiedFiles((prev) => new Map([...prev, [issue.file, result.passed]]));
          if (result.passed) {
            pushStatus('  ✔ Safe to apply (3/3 gates passed)', theme.colors.success);
          } else {
            const failed = Object.entries(result.gates).find(([, g]) => !g.passed);
            pushStatus(
              `  ✘ Blocked at '${failed?.[0]}' gate: ${failed?.[1].blockingReason ?? 'unknown'}`,
              theme.colors.error,
            );
          }
        }
      } catch (err) {
        pushStatus(`  Error: ${String(err)}`, theme.colors.error);
      }
      setIsWorking(false);
      setWorkingLabel('');
    },
    [isWorking, filtered, projectRoot, pushStatus, buildPlan],
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
        if (diffLines) {
          setDiffLines(null);
          return;
        }
        if (filterText) {
          setFilterText('');
          return;
        }
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
        <Text color={theme.colors.brand} bold>
          {' Issues '}
        </Text>
        <Text dimColor>
          {'session '}
          {sessionId}
          {' · '}
          {filtered.length}
          {filterText ? ` of ${issues.length}` : ''}
          {' issues'}
          {' · '}
          {fixableTotal}
          {' fixable'}
          {fixedCount > 0 && <Text color={theme.colors.success}>{` · ${fixedCount} fixed`}</Text>}
        </Text>
        <Text dimColor>{'  '}</Text>
        {isWorking ? (
          <Text color={theme.colors.warning}>{workingLabel}…</Text>
        ) : filterMode ? (
          <Text color={theme.colors.brand}>
            {'/ '}
            {filterText}
            <Text color={theme.colors.brand}>█</Text>
          </Text>
        ) : filterText ? (
          <Text dimColor>
            {'filter: '}
            <Text color={theme.colors.brand}>{filterText}</Text>
            <Text dimColor>{'  Esc clear'}</Text>
          </Text>
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
        const rel = issue.file
          .replace(projectRoot + '/', '')
          .split('/')
          .slice(-2)
          .join('/');
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
            {isSelected ? <Text color={theme.colors.brand}>{'▶'}</Text> : <Text> </Text>}
            <Text color={isSelected ? theme.colors.brand : theme.colors.textDim}>
              {String(globalIdx + 1).padStart(4)}
              {'  '}
            </Text>
            <Text color={SEV_COLOR[issue.severity]} bold={isSelected}>
              {SEV_LABEL[issue.severity]}
              {'  '}
            </Text>
            <Text color={isSelected ? theme.colors.text : theme.colors.textDim}>
              {msg}
              {'  '}
            </Text>
            <Text dimColor>
              {rel}:{issue.line}
              {'  '}
            </Text>
            <Text color={fixColor}>{fixMark}</Text>
          </Box>
        );
      })}

      {/* Scroll position indicator */}
      {filtered.length > pageSize && (
        <Box paddingLeft={2}>
          <Text dimColor>
            {'  '}
            {pageStart + 1}
            {'–'}
            {pageEnd}
            {' of '}
            {filtered.length}
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
                const color = line.startsWith('+')
                  ? theme.colors.diffAdded
                  : line.startsWith('-')
                    ? theme.colors.diffRemoved
                    : theme.colors.textDim;
                return (
                  <Text key={i} color={color}>
                    {line || ' '}
                  </Text>
                );
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
                  <Text color={theme.colors.text}>
                    {selected.suggestion.slice(0, columns - 10)}
                  </Text>
                </Text>
              )}
              <Text>
                <Text dimColor>{'File: '}</Text>
                <Text dimColor>
                  {selected.file.replace(projectRoot + '/', '')}:{selected.line}
                </Text>
                <Text dimColor>
                  {'  blast:'}
                  {selected.blastRadius.level}
                </Text>
                {selected.fixable ? (
                  <Text color={theme.colors.success}>{' [fixable]'}</Text>
                ) : (
                  <Text dimColor>{' [manual]'}</Text>
                )}
                {fixedIds.has(selected.id) && (
                  <Text color={theme.colors.success}>{' ✔ fixed'}</Text>
                )}
                {verifiedFiles.has(selected.file) &&
                  (verifiedFiles.get(selected.file) ? (
                    <Text color={theme.colors.success}>{' ✓ safe'}</Text>
                  ) : (
                    <Text color={theme.colors.error}>{' ✘ blocked'}</Text>
                  ))}
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
            <Text color={theme.colors.brand}>{'a'}</Text>
            {' fix · '}
            <Text color={theme.colors.brand}>{'A'}</Text>
            {' fix all · '}
            <Text color={theme.colors.brand}>{'d'}</Text>
            {' dry-run · '}
            <Text color={theme.colors.brand}>{'v'}</Text>
            {' verify · '}
            <Text color={theme.colors.brand}>{'/'}</Text>
            {' filter · '}
            <Text color={theme.colors.brand}>{'q'}</Text>
            {' quit'}
          </Text>
        )}
      </Box>
    </Box>
  );
}
