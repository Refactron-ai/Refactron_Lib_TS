// src/cli/components/AnimatedMascot.tsx
// Click-triggered animation sequences — identical architecture to Claude Code's
// AnimatedClawd. Container height is fixed at MASCOT_HEIGHT so surrounding
// layout never shifts during bounce animations.
//
// Two animations:
//   JUMP_WAVE   — crouch, spring with arms-up, twice
//   LOOK_AROUND — glance right, then left, then back
// Both cycle at 60ms per frame. Click triggers a random pick.
import React, { useEffect, useRef, useState } from 'react';
import { Box } from 'ink';
import { Mascot, type MascotPose } from './Mascot.js';

type Frame = { pose: MascotPose; offset: number };

function hold(pose: MascotPose, offset: number, frames: number): Frame[] {
  return Array.from({ length: frames }, () => ({ pose, offset }));
}

// Crouch (offset=1 shifts down, feet row clips) then spring (arms-up), twice
const JUMP_WAVE: readonly Frame[] = [
  ...hold('default', 1, 2),
  ...hold('arms-up', 0, 3),
  ...hold('default', 0, 1),
  ...hold('default', 1, 2),
  ...hold('arms-up', 0, 3),
  ...hold('default', 0, 1),
];

const LOOK_AROUND: readonly Frame[] = [
  ...hold('look-right', 0, 5),
  ...hold('look-left', 0, 5),
  ...hold('default', 0, 1),
];

const CLICK_ANIMATIONS: readonly (readonly Frame[])[] = [JUMP_WAVE, LOOK_AROUND];
const IDLE: Frame = { pose: 'default', offset: 0 };
const FRAME_MS = 60;
const MASCOT_HEIGHT = 3;

export function AnimatedMascot(): React.ReactElement {
  const [frameIndex, setFrameIndex] = useState(0); // auto-play intro on mount
  const sequenceRef = useRef<readonly Frame[]>(JUMP_WAVE);

  useEffect(() => {
    if (frameIndex === -1) return;
    if (frameIndex >= sequenceRef.current.length) {
      setFrameIndex(-1);
      return;
    }
    const timer = setTimeout(() => setFrameIndex((i) => i + 1), FRAME_MS);
    return () => clearTimeout(timer);
  }, [frameIndex]);

  const seq = sequenceRef.current;
  const current =
    frameIndex >= 0 && frameIndex < seq.length ? seq[frameIndex]! : IDLE;

  return (
    <Box height={MASCOT_HEIGHT} flexDirection="column">
      <Box marginTop={current.offset} flexShrink={0}>
        <Mascot pose={current.pose} />
      </Box>
    </Box>
  );
}
