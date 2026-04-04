// src/cli/components/AnimatedMascot.tsx
// Mascot that animates based on login state:
//   prompt / api-key  → idle: looks left/right on a slow loop
//   running / verify  → excited: bounces arms-up rapidly
//   success           → arms-up (held)
//   denied / error    → looks away (look-left, static)
import React, { useState, useEffect } from 'react';
import { Text } from 'ink';
import { theme } from '../../ui/theme.js';
import { getMascotRows } from './Mascot.js';
import type { MascotPose } from './Mascot.js';

type AnimState = 'idle' | 'excited' | 'success' | 'sad';

// Idle sequence: slowly look around
const IDLE_SEQ: MascotPose[]   = ['default', 'look-right', 'default', 'look-left', 'default'];
// Excited: arms up and down fast
const EXCITED_SEQ: MascotPose[] = ['arms-up', 'default', 'arms-up', 'default'];

interface AnimatedMascotProps {
  animState: AnimState;
}

export function AnimatedMascot({ animState }: AnimatedMascotProps): React.ReactElement {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (animState === 'success' || animState === 'sad') return; // static
    const ms = animState === 'excited' ? 400 : 900;
    const t = setInterval(() => setTick((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [animState]);

  let pose: MascotPose;
  if (animState === 'success') {
    pose = 'arms-up';
  } else if (animState === 'sad') {
    pose = 'look-left';
  } else if (animState === 'excited') {
    pose = EXCITED_SEQ[tick % EXCITED_SEQ.length]!;
  } else {
    pose = IDLE_SEQ[tick % IDLE_SEQ.length]!;
  }

  const rows = getMascotRows(pose);
  return (
    <>
      <Text color={theme.colors.brand}>{rows[0]}</Text>
      <Text color={theme.colors.brand}>{rows[1]}</Text>
      <Text color={theme.colors.brand}>{rows[2]}</Text>
    </>
  );
}
