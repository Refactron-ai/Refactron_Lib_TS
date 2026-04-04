// src/cli/REPL.tsx
// Standard-Ink REPL: Static for completed output (scrolls naturally),
// dynamic bottom section for spinner / prompt / status line.
import React, { useState, useCallback, useRef } from 'react';
import { Box, Static, Text, useApp, useInput } from 'ink';
import { theme } from '../ui/theme.js';
import { parseInput, executeCommand, type CommandContext } from './runner.js';
import { SpinnerWithVerb } from './components/SpinnerWithVerb.js';
import { StatusLine } from './components/StatusLine.js';
import { PromptInput } from './components/PromptInput.js';
import { createWelcomeBanner } from './components/WelcomeBanner.js';
import type { MessageLine } from './types.js';

export type { MessageLine };

interface REPLProps {
  ctx: CommandContext;
  version: string;
  email?: string | null | undefined;
  plan?: string | null | undefined;
}

export function REPL({ ctx, version, email, plan }: REPLProps): React.ReactElement {
  const { exit } = useApp();

  const [lines, setLines] = useState<MessageLine[]>(() =>
    createWelcomeBanner(version, email, plan, ctx.adapter.displayName),
  );
  const [isRunning, setIsRunning] = useState(false);
  const [runningCmd, setRunningCmd] = useState('');
  const [lastProgressTime, setLastProgressTime] = useState<number>(Date.now());
  const [history, setHistory] = useState<string[]>([]);

  // Issue counts for status line (updated by analyze command)
  const [issueCount] = useState<number | undefined>(undefined);
  const [criticalCount] = useState<number | undefined>(undefined);
  const [sessionState] = useState<string | undefined>(undefined);

  const lineIdRef = useRef(2);
  const abortRef = useRef<AbortController | null>(null);

  const appendLines = useCallback((newLines: MessageLine[]) => {
    setLines((prev) => [...prev, ...newLines]);
    setLastProgressTime(Date.now());
  }, []);

  const handleSubmit = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) return;

      // Add to history (deduplicate consecutive)
      setHistory((prev) => {
        if (prev[prev.length - 1] === trimmed) return prev;
        return [...prev, trimmed];
      });

      // Echo the command
      appendLines([
        {
          id: lineIdRef.current++,
          text: `  ${theme.symbols.arrow} ${trimmed}`,
          color: theme.colors.accent,
        },
      ]);

      const parsed = parseInput(trimmed);

      // Exit
      if (['exit', 'quit', '/exit', 'q'].includes(parsed.command)) {
        appendLines([{ id: lineIdRef.current++, text: '  Goodbye.', color: theme.colors.textDim }]);
        setTimeout(() => exit(), 80);
        return;
      }

      // Clear
      if (parsed.command === 'clear') {
        process.stdout.write('\x1b[H\x1b[2J');
        setLines([]);
        return;
      }

      setIsRunning(true);
      setRunningCmd(trimmed);

      const controller = new AbortController();
      abortRef.current = controller;
      const buffer: MessageLine[] = [];

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

  // Global keys — Ctrl+C to cancel/exit, no scroll keys needed (terminal scrolls naturally)
  useInput(
    (inputChar, key) => {
      if (isRunning) {
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

      if (key.ctrl && inputChar === 'c') {
        appendLines([{ id: lineIdRef.current++, text: '  Goodbye.', color: theme.colors.textDim }]);
        setTimeout(() => exit(), 80);
      }
    },
    { isActive: process.stdin.isTTY === true },
  );

  return (
    <Box flexDirection="column">
      {/*
        Static: Ink renders these items once and never re-renders them.
        They print to stdout and scroll up naturally as new lines appear.
        This is the correct standard-Ink pattern for append-only terminal output.
      */}
      <Static items={lines}>
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

      {/* Dynamic bottom section — spinner while running, prompt when idle */}
      {isRunning ? (
        <SpinnerWithVerb
          verb={runningCmd.split(' ')[0] ?? 'working'}
          isActive={isRunning}
          lastProgressTime={lastProgressTime}
        />
      ) : (
        <PromptInput
          onSubmit={(v) => void handleSubmit(v)}
          isActive={!isRunning}
          history={history}
        />
      )}

      {/* Status line always visible at bottom */}
      <StatusLine
        adapterName={ctx.adapter.displayName}
        version={version}
        issueCount={issueCount}
        criticalCount={criticalCount}
        sessionState={sessionState}
        isRunning={isRunning}
      />
    </Box>
  );
}
