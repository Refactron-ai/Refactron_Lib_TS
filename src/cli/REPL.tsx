// src/cli/REPL.tsx
// Persistent REPL session — Claude Code-style architecture.
//   FullscreenLayout  → alternate screen, fixed viewport height
//   VirtualMessageList → viewport culling, sticky scroll
//   SpinnerWithVerb   → isolated 50ms animation, shimmer sweep, stalled ramp
//   StatusLine        → always-visible bottom bar
//   PromptInput       → history + typeahead + ghost text
import React, { useState, useCallback, useRef } from 'react';
import { useApp, useInput, useStdout } from 'ink';
import { theme } from '../ui/theme.js';
import { parseInput, executeCommand, type CommandContext } from './runner.js';
import { FullscreenLayout } from './components/FullscreenLayout.js';
import { VirtualMessageList, type MessageLine } from './components/VirtualMessageList.js';
import { SpinnerWithVerb } from './components/SpinnerWithVerb.js';
import { StatusLine } from './components/StatusLine.js';
import { PromptInput } from './components/PromptInput.js';

interface REPLProps {
  ctx: CommandContext;
  version: string;
}

// Reserved rows at bottom: spinner row + prompt row + status line
const CHROME_ROWS = 3;

export function REPL({ ctx, version }: REPLProps): React.ReactElement {
  const { exit } = useApp();
  const { stdout } = useStdout();

  const viewportHeight = Math.max(4, (stdout.rows ?? 24) - CHROME_ROWS);

  const [lines, setLines] = useState<MessageLine[]>([
    {
      id: 0,
      text: `  refactron v${version}  —  type help for commands, exit to quit`,
      color: theme.colors.accent,
    },
    { id: 1, text: '', color: undefined },
  ]);
  const [input, setInput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [runningCmd, setRunningCmd] = useState('');
  const [lastProgressTime, setLastProgressTime] = useState<number>(Date.now());
  const [scrollOffset, setScrollOffset] = useState(0); // 0 = sticky bottom
  const [history, setHistory] = useState<string[]>([]);

  // Issue counts for status line (updated on analyze result)
  const [issueCount] = useState<number | undefined>(undefined);
  const [criticalCount] = useState<number | undefined>(undefined);
  const [sessionState] = useState<string | undefined>(undefined);

  const lineIdRef = useRef(2);
  const abortRef = useRef<AbortController | null>(null);

  const appendLines = useCallback((newLines: MessageLine[]) => {
    setLines((prev) => [...prev, ...newLines]);
    setLastProgressTime(Date.now());
    // Reset scroll to bottom on new output (sticky scroll)
    setScrollOffset(0);
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

      // Exit commands
      if (['exit', 'quit', '/exit', 'q'].includes(parsed.command)) {
        appendLines([{ id: lineIdRef.current++, text: '  Goodbye.', color: theme.colors.textDim }]);
        setTimeout(() => exit(), 80);
        return;
      }

      // Clear command
      if (parsed.command === 'clear') {
        process.stdout.write('\x1b[H\x1b[2J'); // clear screen
        setLines([]);
        setScrollOffset(0);
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

  // Global key handler (non-prompt keys when running or scrolling)
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

      // Ctrl+C when idle → exit
      if (key.ctrl && inputChar === 'c') {
        appendLines([{ id: lineIdRef.current++, text: '  Goodbye.', color: theme.colors.textDim }]);
        setTimeout(() => exit(), 80);
        return;
      }

      // Scroll with Page Up / Page Down (when not captured by PromptInput)
      if (key.pageUp) {
        setScrollOffset((s) => Math.min(s + Math.floor(viewportHeight / 2), lines.length));
      }
      if (key.pageDown) {
        setScrollOffset((s) => Math.max(0, s - Math.floor(viewportHeight / 2)));
      }
    },
    { isActive: process.stdin.isTTY === true },
  );

  return (
    <FullscreenLayout>
      {/* Message area — grows to fill available height */}
      <VirtualMessageList
        lines={lines}
        viewportHeight={viewportHeight}
        scrollOffset={scrollOffset}
      />

      {/* Spinner (shown only while running) */}
      {isRunning && (
        <SpinnerWithVerb
          verb={runningCmd.split(' ')[0] ?? 'working'}
          isActive={isRunning}
          lastProgressTime={lastProgressTime}
        />
      )}

      {/* Prompt (shown only when idle) */}
      {!isRunning && (
        <PromptInput
          value={input}
          onChange={setInput}
          onSubmit={(v) => {
            setInput('');
            void handleSubmit(v);
          }}
          isActive={!isRunning}
          history={history}
        />
      )}

      {/* Status line — always visible at bottom */}
      <StatusLine
        adapterName={ctx.adapter.displayName}
        version={version}
        issueCount={issueCount}
        criticalCount={criticalCount}
        sessionState={sessionState}
        isRunning={isRunning}
      />
    </FullscreenLayout>
  );
}
