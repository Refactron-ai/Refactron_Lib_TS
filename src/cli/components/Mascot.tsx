// src/cli/components/Mascot.tsx
// 3-row ASCII mascot for Refactron — same block-character vocabulary as
// Claude Code's Clawd. Segment structure mirrors Clawd exactly:
//   Row 1: r1L + r1E (with background fill) + r1R
//   Row 2: r2L + body (with background fill) + r2R
//   Row 3: feet (static)
// Poses: default, look-left, look-right, arms-up
import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../../ui/theme.js';

export type MascotPose = 'default' | 'arms-up' | 'look-left' | 'look-right';

type Segments = {
  r1L: string; // row 1 left (body color, no bg)
  r1E: string; // row 1 eyes/head (body color + bg fill)
  r1R: string; // row 1 right (body color, no bg)
  r2L: string; // row 2 left arm (body color, no bg)
  r2R: string; // row 2 right arm (body color, no bg)
};

// Exact same segment shapes as Clawd — universal block-art vocabulary
const POSES: Record<MascotPose, Segments> = {
  default: {
    r1L: ' ▐',
    r1E: '▛███▜',
    r1R: '▌',
    r2L: '▝▜',
    r2R: '▛▘',
  },
  'look-left': {
    r1L: ' ▐',
    r1E: '▟███▟',
    r1R: '▌',
    r2L: '▝▜',
    r2R: '▛▘',
  },
  'look-right': {
    r1L: ' ▐',
    r1E: '▙███▙',
    r1R: '▌',
    r2L: '▝▜',
    r2R: '▛▘',
  },
  'arms-up': {
    r1L: '▗▟',
    r1E: '▛███▜',
    r1R: '▙▖',
    r2L: ' ▜',
    r2R: '▛ ',
  },
};

// Refactron brand: accent blue body, dark navy face fill
const BODY = theme.colors.accent;  // #4a9eff
const FACE = theme.colors.primary; // #1e3a5f

interface MascotProps {
  pose?: MascotPose;
}

export function Mascot({ pose = 'default' }: MascotProps): React.ReactElement {
  const p = POSES[pose];
  return (
    <Box flexDirection="column">
      {/* Row 1: head */}
      <Text>
        <Text color={BODY}>{p.r1L}</Text>
        <Text color={BODY} backgroundColor={FACE}>{p.r1E}</Text>
        <Text color={BODY}>{p.r1R}</Text>
      </Text>
      {/* Row 2: body + arms */}
      <Text>
        <Text color={BODY}>{p.r2L}</Text>
        <Text color={BODY} backgroundColor={FACE}>{'█████'}</Text>
        <Text color={BODY}>{p.r2R}</Text>
      </Text>
      {/* Row 3: feet (static across all poses) */}
      <Text color={BODY}>{'  '}▘▘ ▝▝{'  '}</Text>
    </Box>
  );
}
