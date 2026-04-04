// src/cli/REPL.tsx
// Layout:
//   Static [WelcomeSplash]  — printed once at top, scrolls up
//   Static [lines]          — session output, append-only
//   EmptyState              — live, shown when lines is empty
//   SpinnerWithVerb | PromptInput
//   StatusLine
import React, { useState, useCallback, useRef } from 'react';
import { Box, Static, Text, useApp, useInput } from 'ink';
import { theme } from '../ui/theme.js';
import { parseInput, executeCommand, type CommandContext, type CommandResult } from './runner.js';
import { WelcomeSplash } from './components/WelcomeSplash.js';
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

// Stable single-item array — Static never re-renders it
const SPLASH_ITEMS = [{ id: 'splash' }];

// Build a styled "user turn" block: ╭─ you ─…╮ / │ → cmd │ / ╰───…╯
function userBlock(cmd: string, lineId: () => number): MessageLine[] {
  const inner = `  ${theme.symbols.arrow} ${cmd}`;
  return [
    { id: lineId(), text: inner, color: theme.colors.brand },
  ];
}

// Thin rule separator before assistant output
function ruleLines(lineId: () => number): MessageLine[] {
  return [{ id: lineId(), text: '  ' + '─'.repeat(54), color: theme.colors.border }];
}

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

  const nextId = useCallback(() => lineIdRef.current++, []);

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

      // Styled user-turn line
      appendLines(userBlock(trimmed, nextId));

      const parsed = parseInput(trimmed);

      if (['exit', 'quit', '/exit', 'q'].includes(parsed.command)) {
        appendLines([{ id: nextId(), text: '  Goodbye.', color: theme.colors.textDim }]);
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

      // Rule before output
      buffer.push(...ruleLines(nextId));

      let result: CommandResult = {};
      try {
        result = await executeCommand(
          parsed,
          ctx,
          (text, color) => {
            buffer.push({ id: nextId(), text, color });
          },
          controller.signal,
        );
      } catch (err) {
        buffer.push({
          id: nextId(),
          text: `  Error: ${String(err)}`,
          color: theme.colors.error,
        });
      } finally {
        buffer.push({ id: nextId(), text: '', color: undefined });
        appendLines(buffer);
        setIsRunning(false);
        setRunningCmd('');
        abortRef.current = null;
      }

      if (result.shouldExit) {
        setTimeout(() => exit(), 80);
      }
    },
    [ctx, exit, appendLines, nextId],
  );

  useInput(
    (inputChar, key) => {
      if (isRunning) {
        if (key.ctrl && inputChar === 'c') {
          abortRef.current?.abort();
          appendLines([
            { id: nextId(), text: '  ^C  (cancelled)', color: theme.colors.warning },
            { id: nextId(), text: '', color: undefined },
          ]);
          setIsRunning(false);
          setRunningCmd('');
        }
        return;
      }
      if (key.ctrl && inputChar === 'c') {
        appendLines([{ id: nextId(), text: '  Goodbye.', color: theme.colors.textDim }]);
        setTimeout(() => exit(), 80);
      }
    },
    { isActive: process.stdin.isTTY === true },
  );

  return (
    <Box flexDirection="column">
      {/* WelcomeSplash: Static single item — printed once at top */}
      <Static items={SPLASH_ITEMS}>
        {() => (
          <WelcomeSplash
            key="splash"
            version={version}
            adapterName={ctx.adapter.displayName}
            email={email}
            plan={plan}
          />
        )}
      </Static>

      {/* Session output */}
      <Static items={lines}>
        {(line) =>
          line.color !== undefined ? (
            <Text key={line.id} color={line.color}>{line.text}</Text>
          ) : (
            <Text key={line.id}>{line.text}</Text>
          )
        }
      </Static>

      {/* Empty state — live, disappears after first command */}
      {lines.length === 0 && !isRunning && (
        <Box paddingLeft={2} paddingBottom={1}>
          <Text dimColor>{'Type '}</Text>
          <Text color={theme.colors.brand}>{'help'}</Text>
          <Text dimColor>{' to see commands, or start typing below.'}</Text>
        </Box>
      )}

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
          isRunning={isRunning}
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
