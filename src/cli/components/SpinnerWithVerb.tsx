// src/cli/components/SpinnerWithVerb.tsx
// Minimal spinner — anti-flicker design for VS Code's xterm renderer.
//   - Single platform frame cycling at 250ms (4 FPS — animated but not jittery)
//   - Verb in a single brand color (no per-char shimmer; shimmer was emitting
//     N color escape sequences per tick, which xterm's DOM renderer batches
//     with visible reflow)
//   - Stall ramp quantized to 1-second buckets so the spinner color updates at
//     most once per second, not every frame
//   - Reduced-motion: single ● dot, no animation
//
// Before this rewrite: 80ms tick, 7-stop shimmer gradient across verb chars,
// continuous per-frame color lerp on the glyph. Total ~50 ANSI sequences per
// second — too much for VS Code's xterm to render without visible flicker.
// After: 1 cell changes per tick, ~4 ANSI sequences per second. Smooth on
// every terminal we've tested.
import React, { useState, useEffect, memo } from 'react';
import { Box, Text, useStdout } from 'ink';
import { theme } from '../../ui/theme.js';

const BASE_FRAMES = theme.symbols.spinner;

// Error red for stall ramp
const ERROR_RED = { r: 171, g: 43, b: 63 };
const BRAND_RGB = { r: 74, g: 158, b: 255 };

function lerpColor(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
  t: number,
): string {
  const r = Math.round(a.r + (b.r - a.r) * t);
  const g = Math.round(a.g + (b.g - a.g) * t);
  const bl = Math.round(a.b + (b.b - a.b) * t);
  return `rgb(${r},${g},${bl})`;
}

interface RowProps {
  verb: string;
  lastProgressTime: number;
  reducedMotion?: boolean;
}

const SpinnerAnimationRow = memo(function SpinnerAnimationRow({
  verb,
  lastProgressTime,
  reducedMotion = false,
}: RowProps): React.ReactElement {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    // 250ms ≈ 4 FPS for the glyph. Slow enough that VS Code's xterm DOM
    // renderer keeps up cleanly; fast enough to feel alive.
    const ms = reducedMotion ? 0 : 250;
    if (ms === 0) return undefined;
    const t = setInterval(() => setTick((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [reducedMotion]);

  if (reducedMotion) {
    return (
      <Box>
        <Text color={theme.colors.brand}>{theme.symbols.spinnerDot}</Text>
        <Text dimColor>
          {' '}
          {verb}
          {'…'}
        </Text>
      </Box>
    );
  }

  const frame = tick % BASE_FRAMES.length;
  const spinnerChar = BASE_FRAMES[frame] ?? '·';

  // Stall ramp sampled at 1s granularity — color updates at most once per
  // second instead of every frame. Removes a major source of per-tick ANSI
  // churn (was emitting a fresh rgb() on every 80ms tick).
  const stallSeconds = Math.min(Math.floor((Date.now() - lastProgressTime) / 1000), 6);
  const stallIntensity = stallSeconds / 6;
  const spinnerColor =
    stallIntensity >= 1 ? theme.colors.error : lerpColor(BRAND_RGB, ERROR_RED, stallIntensity);

  return (
    <Box>
      <Box width={2} height={1}>
        <Text color={spinnerColor}>{spinnerChar}</Text>
      </Box>
      <Text color={theme.colors.brand}>{verb}</Text>
      <Text dimColor>{'…'}</Text>
    </Box>
  );
});

// ── Hints shown while running ───────────────────────────────────────────────
// Refactron v2 surface: four verbs (analyze, run, document, init) + a small
// set of session/auth helpers. Hints cover the safety story, the verbs, and
// CI usage. No legacy/browser references.
const HINTS = [
  'each refactor passes 3 gates (syntax · imports · tests) before any byte is written',
  "run 'run --dry-run' first to preview the diff, then 'run --apply' to commit",
  "scope a refactor with --transforms=format_to_fstring,class_to_dataclass (or 'all')",
  'cross-file callers / test mocks are detected — unsafe transforms safely skip themselves',
  'use --confidence=high|medium|low to control which findings the analyzer surfaces',
  'failed verification leaves your originals untouched — there is nothing to roll back',
  'press Ctrl+C to cancel the current operation',
  "run 'status' to see details of the active session, 'session list' for history",
  'set REFACTRON_TOKEN in CI to authenticate without an interactive login',
  "run 'init' to scaffold a .refactronrc.json with project defaults",
  '10 deterministic AST transforms — 5 Python (via LibCST) + 5 TypeScript (via ts-morph)',
  'atomic batch write: either every file commits or none — no half-applied refactors',
  "'document' generates docstrings via your local Ollama (or OpenAI/Anthropic if you opt in)",
  'the llm never touches your code — only your docs, and only after verification',
];

// ── HintRow — rotates every 4s, self-managing ───────────────────────────────
// Isolated from the parent so hint rotation doesn't repaint the spinner block.
const HintRow = memo(function HintRow(): React.ReactElement {
  const [hintIdx, setHintIdx] = useState(() => Math.floor(Math.random() * HINTS.length));
  useEffect(() => {
    const t = setInterval(() => {
      setHintIdx((i) => {
        let next = Math.floor(Math.random() * HINTS.length);
        if (next === i) next = (i + 1) % HINTS.length;
        return next;
      });
    }, 4000);
    return () => clearInterval(t);
  }, []);
  return (
    <Box paddingLeft={2} height={1}>
      <Text dimColor>{'hint: '}</Text>
      <Text dimColor>{HINTS[hintIdx]}</Text>
    </Box>
  );
});

// ── SpinnerWithVerb — outer component ───────────────────────────────────────
// Renders ONCE per mount + when its props change. Stall ramp and hint rotation
// are owned by inner memo'd components so timers don't trigger parent re-renders.
// This keeps the terminal-wide top border from repainting on every tick.
interface SpinnerWithVerbProps {
  verb: string;
  isActive: boolean;
  lastProgressTime?: number;
  reducedMotion?: boolean;
}

export function SpinnerWithVerb({
  verb,
  isActive,
  lastProgressTime,
  reducedMotion = false,
}: SpinnerWithVerbProps): React.ReactElement | null {
  const { stdout } = useStdout();
  const columns = stdout?.columns ?? 80;

  if (!isActive) return null;

  return (
    <Box flexDirection="column">
      {/* Top border — mirrors PromptInput's visual boundary */}
      <Text color={theme.colors.border}>{'─'.repeat(columns)}</Text>
      <Box paddingLeft={2}>
        <SpinnerAnimationRow
          verb={verb}
          lastProgressTime={lastProgressTime ?? Date.now()}
          reducedMotion={reducedMotion}
        />
      </Box>
      <HintRow />
    </Box>
  );
}
