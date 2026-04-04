// src/cli/components/SpinnerWithVerb.tsx
// Two-layer architecture matching Claude Code:
//   SpinnerWithVerb — outer, reads state, renders SpinnerAnimationRow
//   SpinnerAnimationRow — inner, OWNS 50ms interval, shimmer sweep, stalled ramp
//   Shimmer: glimmerIndex sweeps L→R across verb chars, only 3 chars near sweep re-render
//   Stalled: no progress for >3s ramps spinner color toward red
import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { theme } from '../../ui/theme.js';

const SPINNER_FRAMES = theme.symbols.spinner;
const SHIMMER_COLORS = [
  '#4a9eff', // base accent
  '#7ab8ff',
  '#aad3ff',
  '#ffffff', // peak
  '#aad3ff',
  '#7ab8ff',
  '#4a9eff',
];
// Color lerp from accent (#4a9eff) toward red (#ff4444) in steps
const STALL_RAMP_COLORS = ['#4a9eff', '#7a8eff', '#aa6eff', '#cc5599', '#ee4466', '#ff4444'];

interface ShimmerCharProps {
  char: string;
  glimmerIndex: number;
  charIndex: number;
}

function ShimmerChar({ char, glimmerIndex, charIndex }: ShimmerCharProps): React.ReactElement {
  const dist = Math.abs(charIndex - glimmerIndex);
  const colorIdx = Math.min(dist, Math.floor(SHIMMER_COLORS.length / 2));
  // Center of sweep = brightest
  const color =
    SHIMMER_COLORS[Math.floor(SHIMMER_COLORS.length / 2) - colorIdx] ?? SHIMMER_COLORS[0]!;
  return <Text color={color}>{char}</Text>;
}

interface SpinnerAnimationRowProps {
  verb: string;
  stallMs: number; // milliseconds since last "progress" signal
}

function SpinnerAnimationRow({ verb, stallMs }: SpinnerAnimationRowProps): React.ReactElement {
  const [frame, setFrame] = useState(0);
  const [glimmerIndex, setGlimmerIndex] = useState(-3);

  useEffect(() => {
    const t = setInterval(() => {
      setFrame((f) => (f + 1) % SPINNER_FRAMES.length);
      setGlimmerIndex((g) => (g + 1) % (verb.length + 6)); // sweep past verb + padding
    }, 50);
    return () => clearInterval(t);
  }, [verb.length]);

  // Stall color ramp
  const stallStep = Math.min(Math.floor(stallMs / 1000), STALL_RAMP_COLORS.length - 1);
  const spinnerColor = STALL_RAMP_COLORS[stallStep] ?? theme.colors.accent;
  const spinnerChar = SPINNER_FRAMES[frame % SPINNER_FRAMES.length] ?? '⠋';

  return (
    <Box>
      <Text color={spinnerColor}>{spinnerChar} </Text>
      {verb.split('').map((char, i) => (
        <ShimmerChar key={i} char={char} glimmerIndex={glimmerIndex} charIndex={i} />
      ))}
      <Text color={theme.colors.textDim}>{'…'}</Text>
    </Box>
  );
}

interface SpinnerWithVerbProps {
  verb: string;
  isActive: boolean;
  lastProgressTime?: number; // Date.now() of last output line
}

export function SpinnerWithVerb({
  verb,
  isActive,
  lastProgressTime,
}: SpinnerWithVerbProps): React.ReactElement | null {
  const [now, setNow] = useState(Date.now);

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
