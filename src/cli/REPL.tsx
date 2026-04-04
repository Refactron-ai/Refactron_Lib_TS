// src/cli/REPL.tsx
// Layout:
//   Static [banner]     — printed once at top, scrolls up naturally
//   Static [lines]      — session output, append-only
//   SpinnerWithVerb     — shown while running
//   PromptInput         — shown when idle
//   StatusLine          — always at bottom
import React, { useState, useCallback, useRef } from 'react';
import { Box, Static, Text, useApp, useInput } from 'ink';
import { theme } from '../ui/theme.js';
import { parseInput, executeCommand, type CommandContext } from './runner.js';
import { Banner } from './components/Banner.js';
import { SpinnerWithVerb } from './components/SpinnerWithVerb.js';
import { StatusLine } from './components/StatusLine.js';
import { PromptInput } from './components/PromptInput.js';
import type { MessageLine } from './types.js';

export type { MessageLine };

interface REPLProps {
  ctx: CommandContext;
  version: string;
  email?: string | null | undefined;
  plan?: string | null | undefined;
}

// Stable single-item array for the banner Static — defined outside component
// so it never changes reference and Static never re-renders it.
const BANNER_ITEMS = [{ id: 'banner' }];

export function REPL({ ctx, version, email, plan }: REPLProps): React.ReactElement {
  const { exit } = useApp();

  const [lines, setLines] = useState<MessageLine[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [runningCmd, setRunningCmd] = useState('');
  const [lastProgressTime, setLastProgressTime] = useState<number>(Date.now());
  const [history, setHistory] = useState<string[]>([]);

  const [issueCount] = useState<number | undefined>(undefined);
  const [criticalCount] = useState<number | undefined>(undefined);
  const [sessionState] = useState<string | undefined>(undefined);

  const lineIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const appendLines = useCallback((newLines: MessageLine[]) => {
    setLines((prev) => [...prev, ...newLines]);
    setLastProgressTime(Date.now());
  }, []);

  const handleSubmit = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) return;

      setHistory((prev) => {
        if (prev[prev.length - 1] === trimmed) return prev;
        return [...prev, trimmed];
      });

      appendLines([
        {
          id: lineIdRef.current++,
          text: `  ${theme.symbols.arrow} ${trimmed}`,
          color: theme.colors.accent,
        },
      ]);

      const parsed = parseInput(trimmed);

      if (['exit', 'quit', '/exit', 'q'].includes(parsed.command)) {
        appendLines([{ id: lineIdRef.current++, text: '  Goodbye.', color: theme.colors.textDim }]);
        setTimeout(() => exit(), 80);
        return;
      }

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
        Banner: single-item Static — Ink prints this once and never touches it
        again. It appears at the very top of the output, above all session lines.
        Using Static here (not a live component) ensures it stays at the top
        as subsequent Static items push it upward naturally.
      */}
      <Static items={BANNER_ITEMS}>
        {() => (
          <Banner
            key="banner"
            version={version}
            adapterName={ctx.adapter.displayName}
            email={email}
            plan={plan}
          />
        )}
      </Static>

      {/*
        Session output: each item printed once, scrolls up naturally.
        No viewport math — the terminal handles scrollback.
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

      {/* Dynamic bottom: spinner while running, prompt when idle */}
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
