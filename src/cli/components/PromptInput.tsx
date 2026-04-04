// src/cli/components/PromptInput.tsx
// YRC PromptInput equivalent (UI only):
//   - Self-contained value state (no per-keystroke parent re-renders)
//   - Block cursor █, ❯ prefix in brand color
//   - Dim placeholder when empty
//   - Ctrl+R history search (reverse-i-search)
//   - Footer hint bar: contextual 1-row hint below input
import React, { useState, useCallback } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { theme } from '../../ui/theme.js';

const KNOWN_COMMANDS = [
  'analyze', 'autofix', 'verify', 'status',
  'rollback', 'diff', 'help', 'login', 'logout', 'auth', 'clear', 'exit',
];

interface PromptInputProps {
  onSubmit: (v: string) => void;
  isActive: boolean;
  isRunning?: boolean; // passed from REPL for footer hint
  history: string[];
}

export function PromptInput({
  onSubmit,
  isActive,
  isRunning = false,
  history,
}: PromptInputProps): React.ReactElement {
  const { stdout } = useStdout();
  const columns = stdout?.columns ?? 80;

  const [value, setValue] = useState('');
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [savedDraft, setSavedDraft] = useState('');

  // ── Ctrl+R history search ─────────────────────────────────────────────
  const [searching, setSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const searchMatch = searching && searchQuery.length > 0
    ? history.slice().reverse().find((h) => h.includes(searchQuery)) ?? ''
    : '';

  // Accept the current search match
  const acceptSearch = useCallback(() => {
    if (searchMatch) setValue(searchMatch);
    setSearching(false);
    setSearchQuery('');
  }, [searchMatch]);

  // Typeahead ghost (only when not searching)
  const ghost =
    !searching && value.length > 0
      ? (KNOWN_COMMANDS.find((cmd) => cmd.startsWith(value) && cmd !== value) ?? '')
      : '';

  useInput(
    (inputChar, key) => {
      if (!isActive) return;

      // ── Ctrl+R: toggle history search ─────────────────────────────────
      if (key.ctrl && inputChar === 'r') {
        if (!searching) {
          setSearching(true);
          setSearchQuery('');
        } else {
          // Cycle to next match by shifting — simplification: just accept current
          acceptSearch();
        }
        return;
      }

      // ── While searching ────────────────────────────────────────────────
      if (searching) {
        if (key.return) { acceptSearch(); return; }
        if (key.escape) { setSearching(false); setSearchQuery(''); return; }
        if (key.backspace || key.delete) {
          setSearchQuery((q) => q.slice(0, -1));
          return;
        }
        if (!key.ctrl && !key.meta && inputChar && inputChar.length > 0) {
          setSearchQuery((q) => q + inputChar);
        }
        return;
      }

      // ── Normal input ───────────────────────────────────────────────────
      if (key.return) {
        const submitted = value;
        setValue('');
        setHistoryIdx(-1);
        setSavedDraft('');
        onSubmit(submitted);
        return;
      }

      if (key.backspace || key.delete) {
        setValue((v) => v.slice(0, -1));
        setHistoryIdx(-1);
        return;
      }

      if (key.upArrow) {
        if (history.length === 0) return;
        if (historyIdx === -1) setSavedDraft(value);
        const idx = Math.min(historyIdx + 1, history.length - 1);
        setHistoryIdx(idx);
        setValue(history[history.length - 1 - idx] ?? '');
        return;
      }

      if (key.downArrow) {
        if (historyIdx <= 0) { setHistoryIdx(-1); setValue(savedDraft); return; }
        const idx = historyIdx - 1;
        setHistoryIdx(idx);
        setValue(history[history.length - 1 - idx] ?? '');
        return;
      }

      // Tab: accept ghost completion
      if (key.tab && ghost) { setValue(ghost); return; }

      if (key.ctrl || key.meta) return;
      if (key.leftArrow || key.rightArrow) return;

      if (inputChar && inputChar.length > 0) {
        setValue((v) => v + inputChar);
        setHistoryIdx(-1);
      }
    },
    { isActive: process.stdin.isTTY === true },
  );

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <Box flexDirection="column">
      {/* Top border — full-width rule separating output from input (YRC-style visual boundary) */}
      <Text color={theme.colors.border}>{'─'.repeat(columns)}</Text>

      {/* History search mode */}
      {searching && (
        <Box paddingLeft={2} gap={1}>
          <Text dimColor>(reverse-i-search):</Text>
          <Text color={theme.colors.brand}>{searchQuery}</Text>
          <Text color={theme.colors.brand}>█</Text>
          {searchMatch !== '' && (
            <Text dimColor>  → {searchMatch}</Text>
          )}
        </Box>
      )}

      {/* Main input row */}
      {!searching && (
        <Box paddingLeft={2}>
          <Text color={theme.colors.brand} bold>{'❯ '}</Text>
          {value.length === 0 ? (
            <>
              <Text color={theme.colors.brand}>{'█'}</Text>
              <Text dimColor>{'  / for commands'}</Text>
            </>
          ) : (
            <>
              <Text color={theme.colors.text}>{value}</Text>
              {/* Ghost typeahead */}
              {ghost.length > 0 && (
                <Text color={theme.colors.promptBorder}>{ghost.slice(value.length)}</Text>
              )}
              <Text color={theme.colors.brand}>{'█'}</Text>
            </>
          )}
        </Box>
      )}

      {/* Footer hint bar — 1 row, matches YRC PromptInputFooterLeftSide */}
      <Box paddingLeft={2} height={1}>
        {isRunning ? (
          <Text dimColor>ctrl+c to cancel</Text>
        ) : searching ? (
          <Text dimColor>Enter to accept · Esc to cancel</Text>
        ) : (
          <Text dimColor>enter to send · ctrl+c to exit · ↑↓ history · ctrl+r search</Text>
        )}
      </Box>
    </Box>
  );
}
