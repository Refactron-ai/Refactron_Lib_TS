// src/cli/components/PromptInput.tsx
// Self-contained prompt — manages its own value state.
// Only calls onSubmit when Enter is pressed — no per-keystroke parent re-renders.
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
  onSubmit: (v: string) => void;
  isActive: boolean;
  history: string[];
}

export function PromptInput({ onSubmit, isActive, history }: PromptInputProps): React.ReactElement {
  const [value, setValue] = useState('');
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

      // History navigation
      if (key.upArrow) {
        if (history.length === 0) return;
        if (historyIdx === -1) setSavedDraft(value);
        const newIdx = Math.min(historyIdx + 1, history.length - 1);
        setHistoryIdx(newIdx);
        setValue(history[history.length - 1 - newIdx] ?? '');
        return;
      }

      if (key.downArrow) {
        if (historyIdx <= 0) {
          setHistoryIdx(-1);
          setValue(savedDraft);
          return;
        }
        const newIdx = historyIdx - 1;
        setHistoryIdx(newIdx);
        setValue(history[history.length - 1 - newIdx] ?? '');
        return;
      }

      // Tab completion — accept ghost
      if (key.tab && ghost) {
        setValue(ghost);
        return;
      }

      if (key.ctrl || key.meta) return;
      if (key.leftArrow || key.rightArrow) return;

      if (inputChar && inputChar.length > 0) {
        setValue((v) => v + inputChar);
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
      {ghost && <Text color={theme.colors.border}>{ghost.slice(value.length)}</Text>}
      <Text color={theme.colors.accent}>{'█'}</Text>
    </Box>
  );
}
