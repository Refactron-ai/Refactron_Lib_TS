// src/cli/REPL.tsx
// Layout:
//   Static [SessionHeader]  — printed once at top, scrolls up
//   Static [lines]          — session output, append-only
//   EmptyState              — live, shown when lines is empty
//   SpinnerWithVerb | PromptInput  (separated from output by a top border)
//   StatusLine
import React, { useState, useCallback, useRef } from 'react';
import { Box, Static, Text, useApp, useInput } from 'ink';
import { theme } from '../ui/theme.js';
import { parseInput, executeCommand, type CommandContext, type CommandResult } from './runner.js';
import { SessionHeader } from './components/SessionHeader.js';
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

// YRC BLACK_CIRCLE: ⏺ on macOS (U+23FA), ● elsewhere (U+25CF)
const OUTPUT_CIRCLE = process.platform === 'darwin' ? '\u23FA' : '\u25CF';

// User turn block: blank spacer + ❯ cmd (figures.pointer, YRC-style)
// ❯ is U+276F — matches the prompt cursor char exactly
function userBlock(cmd: string, lineId: () => number): MessageLine[] {
  return [
    { id: lineId(), text: '', color: undefined },           // blank line before turn
    { id: lineId(), text: `  \u276F ${cmd}`, color: theme.colors.brand },
  ];
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

      let firstOutputSeen = false;

      let result: CommandResult = {};
      try {
        result = await executeCommand(
          parsed,
          ctx,
          (text, color) => {
            if (!firstOutputSeen && text.trim() !== '') {
              firstOutputSeen = true;
              // Prefix the first meaningful line with the circle indicator
              buffer.push({ id: nextId(), text: `  ${OUTPUT_CIRCLE} ${text.trimStart()}`, color });
            } else {
              buffer.push({ id: nextId(), text, color });
            }
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
      {/* ── Output history (append-only, scrolls above the live area) ─────── */}
      <Static items={lines}>
        {(line) =>
          line.color !== undefined ? (
            <Text key={line.id} color={line.color}>{line.text}</Text>
          ) : (
            <Text key={line.id}>{line.text}</Text>
          )
        }
      </Static>

      {/* ── Live viewport ─────────────────────────────────────────────────── */}

      {/* SessionHeader: always visible in the live area (YRC CondensedLogo pattern).
          NOT in Static — Static items render above Ink's managed viewport in alternate
          screen mode and scroll out of view. The header lives here so it stays anchored. */}
      <SessionHeader
        version={version}
        adapterName={ctx.adapter.displayName}
        email={email}
        plan={plan}
      />

      {/* Empty state — disappears after first command */}
      {lines.length === 0 && !isRunning && (
        <Box paddingLeft={2} paddingBottom={1} flexDirection="column">
          <Box gap={1}>
            <Text color={theme.colors.brand}>{OUTPUT_CIRCLE}</Text>
            <Text dimColor>{'Type '}<Text color={theme.colors.brand}>help</Text>{' to see available commands.'}</Text>
          </Box>
          <Box gap={1}>
            <Text color={theme.colors.brand}>{OUTPUT_CIRCLE}</Text>
            <Text dimColor>{'Try: '}<Text color={theme.colors.text}>{'analyze .'}</Text>{' to scan this project.'}</Text>
          </Box>
        </Box>
      )}

      {/* Spinner while running, prompt when idle — both show the top border */}
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
