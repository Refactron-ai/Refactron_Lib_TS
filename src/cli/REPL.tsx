// src/cli/REPL.tsx
// Layout (split between Ink's <Static> and live tree — fixes whole-screen
// flicker on long sessions in DOM-renderer terminals like VS Code's):
//
//   <Static items={[header, ...lines]}>            ← emitted once each, never
//     {SessionHeader | output line}                   re-rendered. Stays in
//   </Static>                                         scrollback above the
//                                                    live tree.
//   <Box flexDirection="column">                   ← live tree, only the
//     EmptyState                                      small dynamic UI.
//     SpinnerWithVerb | PromptInput                   Re-renders on every
//     CtrlCWarning                                    spinner tick are now
//   </Box>                                            cheap (4-5 elements,
//                                                    not hundreds).
//
// Before this change: every 120ms spinner tick caused Ink to walk the
// entire layout tree including ~300 output lines after a typical
// analyze+dry-run session. VS Code's xterm.js DOM renderer redrew the
// whole alt-screen each time, producing visible whole-terminal flicker.
// After: <Static> emits each line exactly once; spinner ticks only redraw
// the live tree (4-5 elements). No flicker even on long sessions.
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Box, Static, Text, useApp, useInput } from 'ink';
import { theme } from '../ui/theme.js';
import { parseInput, executeCommand, type CommandContext, type CommandResult } from './runner.js';
import { SessionHeader } from './components/SessionHeader.js';
import { SpinnerWithVerb } from './components/SpinnerWithVerb.js';
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
    { id: lineId(), text: '', color: undefined }, // blank line before turn
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

  const lineIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const [ctrlCPending, setCtrlCPending] = useState(false);
  const ctrlCTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-dismiss warning ~800ms after it appears (simulates key-release)
  useEffect(() => {
    if (!ctrlCPending) return;
    ctrlCTimerRef.current = setTimeout(() => setCtrlCPending(false), 800);
    return () => {
      if (ctrlCTimerRef.current) clearTimeout(ctrlCTimerRef.current);
    };
  }, [ctrlCPending]);

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
        if (ctrlCPending) {
          // Second press — exit
          appendLines([{ id: nextId(), text: '  Goodbye.', color: theme.colors.textDim }]);
          setTimeout(() => exit(), 80);
        } else {
          // First press — show live warning below prompt
          setCtrlCPending(true);
        }
        return;
      }
    },
    { isActive: process.stdin.isTTY === true },
  );

  // Build the Static item list: a synthetic '__header' marker first so the
  // SessionHeader renders once at the top of scrollback, then each output
  // line. Static emits new items as they appear and never re-renders existing
  // ones, killing the per-spinner-tick whole-screen repaint.
  type StaticItem =
    | { kind: 'header'; key: string }
    | { kind: 'line'; key: number; line: MessageLine };
  const staticItems: StaticItem[] = [
    { kind: 'header', key: '__header' },
    ...lines.map<StaticItem>((line) => ({ kind: 'line', key: line.id, line })),
  ];

  return (
    <>
      {/* ── Append-only history — emitted once per item, never re-rendered ── */}
      <Static items={staticItems}>
        {(item) =>
          item.kind === 'header' ? (
            <SessionHeader
              key={item.key}
              version={version}
              adapterName={ctx.adapter.displayName}
              email={email}
              plan={plan}
            />
          ) : item.line.color !== undefined ? (
            <Text key={item.key} color={item.line.color}>
              {item.line.text}
            </Text>
          ) : (
            <Text key={item.key}>{item.line.text}</Text>
          )
        }
      </Static>

      {/* ── Live tree — small dynamic UI, re-renders cheaply on every tick ── */}
      <Box flexDirection="column">
        {/* Empty state — disappears after first command */}
        {lines.length === 0 && !isRunning && (
          <Box paddingLeft={2} paddingBottom={1} flexDirection="column">
            <Box gap={1}>
              <Text color={theme.colors.brand}>{OUTPUT_CIRCLE}</Text>
              <Text dimColor>
                {'Type '}
                <Text color={theme.colors.brand}>help</Text>
                {' to see available commands.'}
              </Text>
            </Box>
            <Box gap={1}>
              <Text color={theme.colors.brand}>{OUTPUT_CIRCLE}</Text>
              <Text dimColor>
                {'Try: '}
                <Text color={theme.colors.text}>{'analyze .'}</Text>
                {' to scan this project.'}
              </Text>
            </Box>
          </Box>
        )}

        {isRunning ? (
          /* Spinner while running */
          <SpinnerWithVerb
            verb={runningCmd.split(' ')[0] ?? 'working'}
            isActive={isRunning}
            lastProgressTime={lastProgressTime}
          />
        ) : (
          /* Normal prompt */
          <PromptInput
            onSubmit={(v) => void handleSubmit(v)}
            isActive={!isRunning}
            isRunning={isRunning}
            history={history}
          />
        )}

        {/* Ctrl+C warning — live, dismisses on any keypress */}
        {ctrlCPending && (
          <Box paddingLeft={2}>
            <Text color={theme.colors.textDim}>Press </Text>
            <Text color={theme.colors.warning}>Ctrl+C</Text>
            <Text color={theme.colors.textDim}> again to exit</Text>
          </Box>
        )}
      </Box>
    </>
  );
}
