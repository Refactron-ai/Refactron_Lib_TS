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
  theme.colors.brand,        // far
  theme.colors.brandShimmer, // mid
  '#cce4ff',                 // near
  '#ffffff',                 // peak
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
interface RowProps {
  verb: string;
  stallMs: number;
  reducedMotion?: boolean;
}

const SpinnerAnimationRow = memo(function SpinnerAnimationRow({
  verb,
  stallMs,
  reducedMotion = false,
}: RowProps): React.ReactElement {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const ms = reducedMotion ? 1000 : 80;
    const t = setInterval(() => setTick((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [reducedMotion]);

  // ── Reduced motion: ● blinking dot ──────────────────────────────────────
  if (reducedMotion) {
    const visible = tick % 2 === 0;
    return (
      <Box>
        <Text color={theme.colors.brand}>{visible ? theme.symbols.spinnerDot : ' '}</Text>
        <Text dimColor>{' '}{verb}{'…'}</Text>
      </Box>
    );
  }

  // ── Normal animation ──────────────────────────────────────────────────
  const frame = tick % BASE_FRAMES.length;
  const glimmer = tick % (verb.length + 6);

  // Stall: 0 → no ramp, 1 → full error red (after 6s)
  const stallIntensity = Math.min(stallMs / 6000, 1);
  const spinnerColor =
    stallIntensity > 0.5
      ? theme.colors.error
      : lerpColor(BRAND_RGB, ERROR_RED, stallIntensity);

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

// ── SpinnerWithVerb — outer component, stall timer ──────────────────────────
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
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isActive) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [isActive]);

  if (!isActive) return null;

  const stallMs = lastProgressTime != null ? Math.max(0, now - lastProgressTime) : 0;

  return (
    <Box flexDirection="column">
      {/* Top border — mirrors PromptInput's visual boundary */}
      <Text color={theme.colors.border}>{'─'.repeat(columns)}</Text>
      <Box paddingLeft={2}>
        <SpinnerAnimationRow
          verb={verb}
          stallMs={stallMs}
          reducedMotion={reducedMotion}
        />
      </Box>
    </Box>
  );
}
