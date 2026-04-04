// src/cli/components/SpinnerWithVerb.tsx
// Spinner with shimmer sweep across verb text.
// Architecture: SpinnerAnimationRow owns one 80ms interval (was 50ms — reduced
// to cut render rate). Shimmer is computed per-render from a single index
// and rendered as React.Fragment of Text nodes — no extra component per char.
// SpinnerWithVerb outer component owns stall detection (500ms interval,
// only while active).
import React, { useState, useEffect, memo } from 'react';
import { Box, Text } from 'ink';
import { theme } from '../../ui/theme.js';

const SPINNER_FRAMES = theme.symbols.spinner;

// Color ramp accent → white → accent for shimmer center
const SHIMMER_COLORS = ['#4a9eff', '#7ab8ff', '#aad3ff', '#ffffff', '#aad3ff', '#7ab8ff', '#4a9eff'];
// Color ramp accent → red for stall
const STALL_RAMP = ['#4a9eff', '#7a8eff', '#aa6eff', '#cc5599', '#ee4466', '#ff4444'];

interface SpinnerAnimationRowProps {
  verb: string;
  stallMs: number;
}

const SpinnerAnimationRow = memo(function SpinnerAnimationRow({
  verb,
  stallMs,
}: SpinnerAnimationRowProps): React.ReactElement {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 80);
    return () => clearInterval(t);
  }, []);

  const frame = tick % SPINNER_FRAMES.length;
  const glimmer = tick % (verb.length + 6);

  const stallStep = Math.min(Math.floor(stallMs / 1000), STALL_RAMP.length - 1);
  const spinnerColor = STALL_RAMP[stallStep] ?? theme.colors.accent;
  const spinnerChar = SPINNER_FRAMES[frame] ?? '⠋';

  const half = Math.floor(SHIMMER_COLORS.length / 2);

  return (
    <Box>
      <Text color={spinnerColor}>{spinnerChar} </Text>
      {verb.split('').map((char, i) => {
        const dist = Math.min(Math.abs(i - glimmer), half);
        const color = SHIMMER_COLORS[half - dist] ?? SHIMMER_COLORS[0]!;
        return (
          <Text key={i} color={color}>
            {char}
          </Text>
        );
      })}
      <Text color={theme.colors.textDim}>{'…'}</Text>
    </Box>
  );
});

interface SpinnerWithVerbProps {
  verb: string;
  isActive: boolean;
  lastProgressTime?: number;
}

export function SpinnerWithVerb({
  verb,
  isActive,
  lastProgressTime,
}: SpinnerWithVerbProps): React.ReactElement | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isActive) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [isActive]);

  if (!isActive) return null;

  const stallMs = lastProgressTime != null ? Math.max(0, now - lastProgressTime) : 0;

  return (
    <Box paddingLeft={2}>
      <SpinnerAnimationRow verb={verb} stallMs={stallMs} />
    </Box>
  );
}
