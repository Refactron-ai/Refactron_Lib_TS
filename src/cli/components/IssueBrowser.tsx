// src/cli/components/IssueBrowser.tsx
// Interactive issue browser — the central hub for the analyze→fix pipeline.
//
// Layout:
//   header bar  — session id, counts, filter hint
//   ─ separator
//   issue list  — paginated, ↑↓ navigation, selected row highlighted
//   ─ separator
//   detail panel — message, suggestion, file, status / diff preview
//   ─ separator
//   footer hints — contextual keybindings
//
// Keys:
//   ↑↓          navigate
//   a           fix selected issue (writes file, stays in browser)
//   d           dry-run selected issue (shows diff in detail panel)
//   /           enter filter mode (type to filter by message or file)
//   Esc         clear filter / exit filter mode
//   q           exit browser
import React, { useState, useCallback, useMemo } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import fs from 'fs/promises';
import { theme } from '../../ui/theme.js';
import { AutoFixEngine } from '../../autofix/engine.js';
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
  const [statusMsg, setStatusMsg] = useState('');
  const [diffLines, setDiffLines] = useState<string[] | null>(null);
  const [isFixing, setIsFixing] = useState(false);

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
  const DETAIL_ROWS = 5; // sep + 3 detail lines + sep
  const FOOTER_ROWS = 1;
  const pageSize = Math.max(3, rows - HEADER_ROWS - DETAIL_ROWS - FOOTER_ROWS);
  const pageStart = Math.max(0, clampedIdx - Math.floor(pageSize / 2));
  const pageEnd = Math.min(filtered.length, pageStart + pageSize);
  const pageIssues = filtered.slice(pageStart, pageEnd);

  // ── Fix a single issue ─────────────────────────────────────────────────
  const fixIssue = useCallback(
    async (issue: CodeIssue, dry: boolean) => {
      if (isFixing) return;
      if (!issue.fixable) {
        setStatusMsg('  Not auto-fixable.');
        setDiffLines(null);
        return;
      }
      setIsFixing(true);
      setDiffLines(null);
      setStatusMsg('  Fixing…');
      try {
        const engine = new AutoFixEngine();
        const code = await fs.readFile(issue.file, 'utf-8');
        const transform = await engine.fix(issue.file, code, issue);
        if (!transform) {
          setStatusMsg('  No transform produced.');
          setIsFixing(false);
          return;
        }
        if (dry) {
          const diff = adapter.generateDiff(code, transform.transformedCode);
          setDiffLines(diff.split('\n').slice(0, 8)); // show first 8 diff lines
          setStatusMsg('  Dry-run preview — nothing written.');
        } else {
          const backup = new BackupManager(projectRoot);
          await backup.backup(issue.file);
          await atomicWrite(issue.file, transform.transformedCode);
          setFixedIds((prev) => new Set([...prev, issue.id]));
          setFixedFiles((prev) => new Set([...prev, issue.file]));
          setStatusMsg(`  ✔ Fixed ${issue.file.split('/').pop()}:${issue.line}`);
        }
      } catch (err) {
        setStatusMsg(`  Error: ${String(err)}`);
      }
      setIsFixing(false);
    },
    [isFixing, adapter, projectRoot],
  );

  // ── Input ──────────────────────────────────────────────────────────────
  useInput(
    (inputChar, key) => {
      if (isFixing) return;

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

      // Navigation
      if (key.upArrow) {
        setSelectedIdx((i) => Math.max(0, i - 1));
        setDiffLines(null);
        return;
      }
      if (key.downArrow) {
        setSelectedIdx((i) => Math.min(filtered.length - 1, i + 1));
        setDiffLines(null);
        return;
      }

      // Fix selected
      if (inputChar === 'a' && selected) {
        void fixIssue(selected, false);
        return;
      }

      // Dry-run selected
      if (inputChar === 'd' && selected) {
        void fixIssue(selected, true);
        return;
      }

      // Filter
      if (inputChar === '/') {
        setFilterMode(true);
        setFilterText('');
        return;
      }

      // Clear filter
      if (key.escape) {
        setFilterText('');
        setFilterMode(false);
        setDiffLines(null);
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
  const fixable = issues.filter((i) => i.fixable).length;
  const fixedCount = fixedIds.size;

  return (
    <Box flexDirection="column">
      {/* ── Header ────────────────────────────────────────────────────── */}
      <Box>
        <Text color={theme.colors.brand} bold>{' Issues '}</Text>
        <Text dimColor>session {sessionId} · {filtered.length}{filterText ? ` of ${issues.length}` : ''} issues · {fixable} fixable · {fixedCount} fixed</Text>
        <Text dimColor>{'  '}</Text>
        {filterMode ? (
          <Text color={theme.colors.brand}>{'/ '}{filterText}<Text color={theme.colors.brand}>█</Text></Text>
        ) : filterText ? (
          <Text dimColor>{'filter: '}<Text color={theme.colors.brand}>{filterText}</Text><Text dimColor>{'  Esc to clear'}</Text></Text>
        ) : (
          <Text dimColor>{'/ to filter · q to quit'}</Text>
        )}
      </Box>
      <Text color={theme.colors.border}>{border}</Text>

      {/* ── Column labels ─────────────────────────────────────────────── */}
      <Box paddingLeft={1}>
        <Text dimColor>{'  #  '}</Text>
        <Text dimColor>{'SEV  '}</Text>
        <Text dimColor>{'MESSAGE'.padEnd(Math.max(20, columns - 40))}</Text>
        <Text dimColor>{'FILE'}</Text>
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
        const rel = issue.file.replace(projectRoot + '/', '').split('/').slice(-2).join('/');
        const msgWidth = Math.max(20, columns - 42);
        const msg = issue.message.slice(0, msgWidth).padEnd(msgWidth);
        const fixMark = isFixed ? '✔' : issue.fixable ? '·' : ' ';
        const fixColor = isFixed ? theme.colors.success : issue.fixable ? theme.colors.brand : theme.colors.textDim;

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

      {/* Scroll indicator */}
      {filtered.length > pageSize && (
        <Box paddingLeft={2}>
          <Text dimColor>
            {`  ${pageStart + 1}–${pageEnd} of ${filtered.length}`}
          </Text>
        </Box>
      )}

      {/* ── Detail panel ──────────────────────────────────────────────── */}
      <Text color={theme.colors.border}>{border}</Text>
      {selected ? (
        <Box flexDirection="column" paddingLeft={2}>
          {diffLines ? (
            <>
              {diffLines.map((line, i) => {
                const color = line.startsWith('+') ? theme.colors.diffAdded
                  : line.startsWith('-') ? theme.colors.diffRemoved
                  : theme.colors.textDim;
                return <Text key={i} color={color}>{line}</Text>;
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
                <Text dimColor>{'  blast: '}{selected.blastRadius.level}</Text>
                {selected.fixable && <Text color={theme.colors.success}>{' [fixable]'}</Text>}
              </Text>
            </>
          )}
          {statusMsg !== '' && (
            <Text color={theme.colors.textDim}>{statusMsg}</Text>
          )}
        </Box>
      ) : (
        <Box paddingLeft={2}>
          <Text dimColor>No issue selected.</Text>
        </Box>
      )}
      <Text color={theme.colors.border}>{border}</Text>

      {/* ── Footer ────────────────────────────────────────────────────── */}
      <Box paddingLeft={1}>
        {filterMode ? (
          <Text dimColor>{'Type to filter · Enter/Esc to confirm'}</Text>
        ) : (
          <Text dimColor>
            {'↑↓ navigate · '}
            <Text color={theme.colors.brand}>{'a'}</Text>
            {' fix · '}
            <Text color={theme.colors.brand}>{'d'}</Text>
            {' dry-run · '}
            <Text color={theme.colors.brand}>{'/'}</Text>
            {' filter · '}
            <Text color={theme.colors.brand}>{'Esc'}</Text>
            {' clear · '}
            <Text color={theme.colors.brand}>{'q'}</Text>
            {' quit'}
          </Text>
        )}
      </Box>
    </Box>
  );
}
