// src/cli/components/PromptInput.tsx
// Enhanced prompt input with:
//   - History navigation (up/down arrow keys)
//   - Typeahead ghost text from command completions
//   - Cursor block (█) at insert position
//   - Slash command hint on empty input
import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { theme } from '../../ui/theme.js';

const KNOWN_COMMANDS = [
  'analyze',
  'autofix',
  'verify',
  'status',
  'rollback',
  'diff',
  'help',
  'clear',
  'exit',
];

interface PromptInputProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  isActive: boolean;
  history: string[];
}

export function PromptInput({
  value,
  onChange,
  onSubmit,
  isActive,
  history,
}: PromptInputProps): React.ReactElement {
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [savedDraft, setSavedDraft] = useState('');

  // Typeahead: find first command that starts with current input
  const ghost =
    value.length > 0
      ? (KNOWN_COMMANDS.find((cmd) => cmd.startsWith(value) && cmd !== value) ?? '')
      : '';

  useInput(
    (inputChar, key) => {
      if (!isActive) return;

      if (key.return) {
        setHistoryIdx(-1);
        setSavedDraft('');
        onSubmit(value);
        return;
      }

      if (key.backspace || key.delete) {
        onChange(value.slice(0, -1));
        setHistoryIdx(-1);
        return;
      }

      // History navigation
      if (key.upArrow) {
        if (history.length === 0) return;
        if (historyIdx === -1) setSavedDraft(value);
        const newIdx = Math.min(historyIdx + 1, history.length - 1);
        setHistoryIdx(newIdx);
        onChange(history[history.length - 1 - newIdx] ?? '');
        return;
      }

      if (key.downArrow) {
        if (historyIdx <= 0) {
          setHistoryIdx(-1);
          onChange(savedDraft);
          return;
        }
        const newIdx = historyIdx - 1;
        setHistoryIdx(newIdx);
        onChange(history[history.length - 1 - newIdx] ?? '');
        return;
      }

      // Tab completion — accept ghost
      if (key.tab && ghost) {
        onChange(ghost);
        return;
      }

      if (key.ctrl || key.meta) return;
      if (key.leftArrow || key.rightArrow) return;

      if (inputChar && inputChar.length > 0) {
        onChange(value + inputChar);
        setHistoryIdx(-1);
      }
    },
    { isActive: process.stdin.isTTY === true },
  );

  return (
    <Box paddingLeft={2}>
      <Text color={theme.colors.accent} bold>
        {'❯ '}
      </Text>
      <Text color={theme.colors.text}>{value}</Text>
      {/* Ghost typeahead */}
      {ghost && <Text color={theme.colors.border}>{ghost.slice(value.length)}</Text>}
      {/* Block cursor */}
      <Text color={theme.colors.accent}>{'█'}</Text>
    </Box>
  );
}
