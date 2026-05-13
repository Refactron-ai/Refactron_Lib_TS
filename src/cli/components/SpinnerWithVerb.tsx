// src/cli/components/SpinnerWithVerb.tsx
// YRC-equivalent spinner:
//   - Platform-aware frames: ['·','✢','✳','✶','✻','✽'] forward+reverse (12 total)
//   - Shimmer sweep across verb text (GlimmerMessage equivalent)
//   - Stall ramp: color interpolates toward error red after 3s of no progress
//   - Reduced-motion: single ● dot with 1s blink
//   - SpinnerAnimationRow wrapped in memo — owns 80ms interval
import React, { useState, useEffect, memo } from 'react';
import { Box, Text, useStdout } from 'ink';
import { theme } from '../../ui/theme.js';

// ── Frames (YRC SpinnerGlyph pattern) ──────────────────────────────────────
const BASE_FRAMES = theme.symbols.spinner; // set by platform in theme.ts
const SHIMMER_HALF = 3;
const SHIMMER_COLORS = [
  theme.colors.brand, // far
  theme.colors.brandShimmer, // mid
  '#cce4ff', // near
  '#ffffff', // peak
  '#cce4ff',
  theme.colors.brandShimmer,
  theme.colors.brand,
];

// Error red for stall ramp (matches YRC's ERROR_RED)
const ERROR_RED = { r: 171, g: 43, b: 63 }; // YRC SpinnerGlyph.tsx exact value
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

// ── SpinnerAnimationRow — owns 80ms interval ────────────────────────────────
// Self-managing: tracks its own stall time off lastProgressTime so the parent
// component never needs to re-render. Previously the parent ticked every 500ms
// to recompute stall, which caused the whole spinner block (including the
// terminal-wide top border) to repaint every half-second — visible jitter on
// terminals that don't smoothly handle alt-screen partial repaints.
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
    const ms = reducedMotion ? 1000 : 80;
    const t = setInterval(() => setTick((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [reducedMotion]);

  // Compute stall from the latest progress time on each animation tick.
  // No extra render — `tick` is already changing every 80ms.
  const stallMs = Math.max(0, Date.now() - lastProgressTime);

  // ── Reduced motion: ● blinking dot ──────────────────────────────────────
  if (reducedMotion) {
    const visible = tick % 2 === 0;
    return (
      <Box>
        <Text color={theme.colors.brand}>{visible ? theme.symbols.spinnerDot : ' '}</Text>
        <Text dimColor>
          {' '}
          {verb}
          {'…'}
        </Text>
      </Box>
    );
  }

  // ── Normal animation ──────────────────────────────────────────────────
  const frame = tick % BASE_FRAMES.length;
  const glimmer = tick % (verb.length + 6);

  // Stall: 0 → no ramp, 1 → full error red (after 6s)
  const stallIntensity = Math.min(stallMs / 6000, 1);
  const spinnerColor =
    stallIntensity > 0.5 ? theme.colors.error : lerpColor(BRAND_RGB, ERROR_RED, stallIntensity);

  const spinnerChar = BASE_FRAMES[frame] ?? '·';

  return (
    <Box>
      {/* Glyph cell: width=2 height=1, matches YRC SpinnerGlyph */}
      <Box width={2} height={1}>
        <Text color={spinnerColor}>{spinnerChar}</Text>
      </Box>
      {/* Verb with shimmer sweep */}
      {verb.split('').map((char, i) => {
        const dist = Math.min(Math.abs(i - glimmer), SHIMMER_HALF);
        const color = SHIMMER_COLORS[SHIMMER_HALF - dist] ?? SHIMMER_COLORS[0]!;
        return (
          <Text key={i} color={color}>
            {char}
          </Text>
        );
      })}
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
