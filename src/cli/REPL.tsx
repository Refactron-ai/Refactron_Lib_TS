// src/cli/REPL.tsx
// Persistent REPL session — mounts once, stays alive until user exits.
// Architecture mirrors Claude Code: React event loop IS the session.
import React, { useState, useCallback, useRef } from 'react';
import { Box, Text, Static, useInput, useApp } from 'ink';
import { theme } from '../ui/theme.js';
import { parseInput, executeCommand, type CommandContext } from './runner.js';

interface OutputLine {
  id: number;
  text: string;
  color: string | undefined;
}

interface REPLProps {
  ctx: CommandContext;
  version: string;
}

export function REPL({ ctx, version }: REPLProps): React.ReactElement {
  const { exit } = useApp();
  const [completedLines, setCompletedLines] = useState<OutputLine[]>([
    {
      id: 0,
      text: `  refactron v${version}  —  type help for commands, exit to quit`,
      color: theme.colors.accent,
    },
    { id: 1, text: '', color: undefined },
  ]);
  const [input, setInput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [spinnerFrame, setSpinnerFrame] = useState(0);
  const [runningCmd, setRunningCmd] = useState('');
  const lineIdRef = useRef(2);
  const abortRef = useRef<AbortController | null>(null);

  // Spinner tick
  React.useEffect(() => {
    if (!isRunning) return;
    const t = setInterval(() => setSpinnerFrame((f) => (f + 1) % theme.symbols.spinner.length), 80);
    return () => clearInterval(t);
  }, [isRunning]);

  const appendLines = useCallback((lines: OutputLine[]) => {
    setCompletedLines((prev) => [...prev, ...lines]);
  }, []);

  const handleSubmit = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) return;

      // Echo the command
      appendLines([
        {
          id: lineIdRef.current++,
          text: `  ${theme.symbols.arrow} ${trimmed}`,
          color: theme.colors.accent,
        },
      ]);

      const parsed = parseInput(trimmed);

      // Exit commands
      if (['exit', 'quit', '/exit', 'q'].includes(parsed.command)) {
        appendLines([{ id: lineIdRef.current++, text: '  Goodbye.', color: theme.colors.textDim }]);
        setTimeout(() => exit(), 80);
        return;
      }

      // Clear command
      if (parsed.command === 'clear') {
        process.stdout.write('\x1Bc');
        setCompletedLines([]);
        return;
      }

      setIsRunning(true);
      setRunningCmd(trimmed);

      const controller = new AbortController();
      abortRef.current = controller;
      const buffer: OutputLine[] = [];

      try {
        await executeCommand(
          parsed,
          ctx,
          (text, color) => {
            buffer.push({ id: lineIdRef.current++, text, color });
          },
          controller.signal,
        );
      } catch (err) {
        buffer.push({
          id: lineIdRef.current++,
          text: `  Error: ${String(err)}`,
          color: theme.colors.error,
        });
      } finally {
        buffer.push({ id: lineIdRef.current++, text: '', color: undefined });
        appendLines(buffer);
        setIsRunning(false);
        setRunningCmd('');
        abortRef.current = null;
      }
    },
    [ctx, exit, appendLines],
  );

  useInput(
    (inputChar, key) => {
      if (isRunning) {
        // Ctrl+C cancels running command
        if (key.ctrl && inputChar === 'c') {
          abortRef.current?.abort();
          appendLines([
            { id: lineIdRef.current++, text: '  ^C  (cancelled)', color: theme.colors.warning },
            { id: lineIdRef.current++, text: '', color: undefined },
          ]);
          setIsRunning(false);
          setRunningCmd('');
        }
        return;
      }

      // Ctrl+C when idle → exit
      if (key.ctrl && inputChar === 'c') {
        appendLines([{ id: lineIdRef.current++, text: '  Goodbye.', color: theme.colors.textDim }]);
        setTimeout(() => exit(), 80);
        return;
      }

      if (key.return) {
        const submitted = input;
        setInput('');
        void handleSubmit(submitted);
        return;
      }

      if (key.backspace || key.delete) {
        setInput((prev) => prev.slice(0, -1));
        return;
      }

      if (key.ctrl || key.meta) return;

      if (inputChar && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow) {
        setInput((prev) => prev + inputChar);
      }
    },
    { isActive: process.stdin.isTTY === true },
  );

  return (
    <Box flexDirection="column">
      {/* Completed output — Static never re-renders old lines */}
      <Static items={completedLines}>
        {(line) =>
          line.color !== undefined ? (
            <Text key={line.id} color={line.color}>
              {line.text}
            </Text>
          ) : (
            <Text key={line.id}>{line.text}</Text>
          )
        }
      </Static>

      {/* Spinner while running */}
      {isRunning && (
        <Text color={theme.colors.accent}>
          {'  '}
          {theme.symbols.spinner[spinnerFrame % theme.symbols.spinner.length]}
          {'  '}
          {runningCmd}
        </Text>
      )}

      {/* Prompt */}
      {!isRunning && (
        <Box>
          <Text color={theme.colors.accent} bold>
            {'  ❯ '}
          </Text>
          <Text color={theme.colors.text}>{input}</Text>
          <Text color={theme.colors.accent}>{'█'}</Text>
        </Box>
      )}
    </Box>
  );
}
