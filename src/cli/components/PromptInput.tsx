// src/cli/components/PromptInput.tsx
// YRC PromptInput equivalent (UI only):
//   - Self-contained value state (no per-keystroke parent re-renders)
//   - Block cursor █, ❯ prefix in brand color
//   - Dim placeholder when empty
//   - Ctrl+R history search (reverse-i-search)
//   - Slash command picker: typing '/' shows filterable command menu
//   - Footer hint bar: contextual 1-row hint below input
import React, { useState, useCallback } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { theme } from '../../ui/theme.js';

interface SlashCommand {
  name: string;      // without leading slash
  description: string;
}

const SLASH_COMMANDS: SlashCommand[] = [
  { name: 'analyze',  description: 'Scan files for issues' },
  { name: 'autofix',  description: 'Fix issues with verification' },
  { name: 'verify',   description: 'Verify a file is safe to change' },
  { name: 'status',   description: 'Show last session summary' },
  { name: 'diff',     description: 'Show fix diff' },
  { name: 'rollback', description: 'Restore from last backup' },
  { name: 'login',    description: 'Authenticate with Refactron' },
  { name: 'logout',   description: 'Remove stored credentials' },
  { name: 'auth',     description: 'Show auth status' },
  { name: 'clear',    description: 'Clear the screen' },
  { name: 'exit',     description: 'Quit Refactron' },
  { name: 'help',     description: 'Show all commands' },
];

// Names for typeahead ghost (bare, no slash)
const KNOWN_COMMANDS = SLASH_COMMANDS.map((c) => c.name);

interface PromptInputProps {
  onSubmit: (v: string) => void;
  isActive: boolean;
  isRunning?: boolean;
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

  // ── Slash command picker ──────────────────────────────────────────────
  const [slashIdx, setSlashIdx] = useState(0); // selected row index

  const isSlashMode = !searching && value.startsWith('/');
  const slashQuery = isSlashMode ? value.slice(1).toLowerCase() : '';
  const slashMatches = isSlashMode
    ? SLASH_COMMANDS.filter((c) => c.name.startsWith(slashQuery))
    : [];

  const searchMatch = searching && searchQuery.length > 0
    ? history.slice().reverse().find((h) => h.includes(searchQuery)) ?? ''
    : '';

  const acceptSearch = useCallback(() => {
    if (searchMatch) setValue(searchMatch);
    setSearching(false);
    setSearchQuery('');
  }, [searchMatch]);

  // Typeahead ghost (only when not searching and not slash mode)
  const ghost =
    !searching && !isSlashMode && value.length > 0
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

      // ── Slash picker navigation ────────────────────────────────────────
      if (isSlashMode && slashMatches.length > 0) {
        if (key.upArrow) {
          setSlashIdx((i) => Math.max(0, i - 1));
          return;
        }
        if (key.downArrow) {
          setSlashIdx((i) => Math.min(slashMatches.length - 1, i + 1));
          return;
        }
        if (key.tab || key.return) {
          const selected = slashMatches[Math.min(slashIdx, slashMatches.length - 1)];
          if (selected) {
            if (key.return) {
              // Submit immediately
              setValue('');
              setHistoryIdx(-1);
              setSavedDraft('');
              setSlashIdx(0);
              onSubmit(`/${selected.name}`);
            } else {
              // Tab: fill input only
              setValue(`/${selected.name} `);
              setSlashIdx(0);
            }
          }
          return;
        }
        if (key.escape) {
          setValue('');
          setSlashIdx(0);
          return;
        }
      }

      // ── Normal input ───────────────────────────────────────────────────
      if (key.return) {
        const submitted = value;
        setValue('');
        setHistoryIdx(-1);
        setSavedDraft('');
        setSlashIdx(0);
        onSubmit(submitted);
        return;
      }

      if (key.backspace || key.delete) {
        setValue((v) => v.slice(0, -1));
        setHistoryIdx(-1);
        setSlashIdx(0);
        return;
      }

      if (key.upArrow) {
        if (isSlashMode) return; // handled above
        if (history.length === 0) return;
        if (historyIdx === -1) setSavedDraft(value);
        const idx = Math.min(historyIdx + 1, history.length - 1);
        setHistoryIdx(idx);
        setValue(history[history.length - 1 - idx] ?? '');
        return;
      }

      if (key.downArrow) {
        if (isSlashMode) return; // handled above
        if (historyIdx <= 0) { setHistoryIdx(-1); setValue(savedDraft); return; }
        const idx = historyIdx - 1;
        setHistoryIdx(idx);
        setValue(history[history.length - 1 - idx] ?? '');
        return;
      }

      // Tab: accept ghost completion (not in slash mode — handled above)
      if (key.tab && ghost) { setValue(ghost); return; }

      if (key.ctrl || key.meta) return;
      if (key.leftArrow || key.rightArrow) return;

      if (inputChar && inputChar.length > 0) {
        setValue((v) => v + inputChar);
        setHistoryIdx(-1);
        setSlashIdx(0);
      }
    },
    { isActive: process.stdin.isTTY === true },
  );

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <Box flexDirection="column">
      {/* Top border */}
      <Text color={theme.colors.border}>{'─'.repeat(columns)}</Text>

      {/* Slash command picker — shown above the input row */}
      {isSlashMode && slashMatches.length > 0 && (
        <Box flexDirection="column" paddingLeft={2} paddingBottom={1}>
          {slashMatches.map((cmd, i) => {
            const selected = i === Math.min(slashIdx, slashMatches.length - 1);
            return (
              <Box key={cmd.name} gap={2}>
                <Text color={selected ? theme.colors.brand : theme.colors.text} bold={selected}>
                  {'/' + cmd.name.padEnd(10)}
                </Text>
                {selected ? (
                  <Text color={theme.colors.text}>{cmd.description}</Text>
                ) : (
                  <Text dimColor>{cmd.description}</Text>
                )}
              </Box>
            );
          })}
        </Box>
      )}

      {/* No match for slash query */}
      {isSlashMode && slashMatches.length === 0 && (
        <Box paddingLeft={2} paddingBottom={1}>
          <Text dimColor>No matching command</Text>
        </Box>
      )}

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

      {/* Footer hint bar */}
      <Box paddingLeft={2} height={1}>
        {isRunning ? (
          <Text dimColor>ctrl+c to cancel</Text>
        ) : searching ? (
          <Text dimColor>Enter to accept · Esc to cancel</Text>
        ) : isSlashMode && slashMatches.length > 0 ? (
          <Text dimColor>↑↓ navigate · Enter to run · Tab to fill · Esc to clear</Text>
        ) : (
          <Text dimColor>enter to send · ctrl+c to exit · ↑↓ history · ctrl+r search</Text>
        )}
      </Box>
    </Box>
  );
}
