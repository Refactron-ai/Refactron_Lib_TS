// src/cli/components/Mascot.tsx
// 3-row ASCII mascot using block-drawing characters.
// IMPORTANT: foreground color only — no backgroundColor.
// backgroundColor on Text+block chars causes terminal render glitches.
import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../../ui/theme.js';

export type MascotPose = 'default' | 'arms-up' | 'look-left' | 'look-right';

// Each pose: 3 rows as plain strings (rendered in accent color, no bg)
const POSES: Record<MascotPose, [string, string, string]> = {
  'default':    ['▗▄████▄▖', '▐▌ ▄▄ ▐▌', ' ▝▘  ▝▘ '],
  'look-left':  ['▗▄████▄▖', '▐▌▄▄  ▐▌', ' ▝▘  ▝▘ '],
  'look-right': ['▗▄████▄▖', '▐▌  ▄▄▐▌', ' ▝▘  ▝▘ '],
  'arms-up':    ['▗▄████▄▖', '▟▌ ▄▄ ▐▙', ' ▝▘  ▝▘ '],
};

interface MascotProps {
  pose?: MascotPose;
}

export function Mascot({ pose = 'default' }: MascotProps): React.ReactElement {
  const rows = POSES[pose];
  return (
    <Box flexDirection="column">
      <Text color={theme.colors.accent}>{rows[0]}</Text>
      <Text color={theme.colors.accent}>{rows[1]}</Text>
      <Text color={theme.colors.accent}>{rows[2]}</Text>
    </Box>
  );
}

// Returns the 3 mascot rows as plain strings for embedding in Static text
export function getMascotRows(pose: MascotPose = 'default'): [string, string, string] {
  return POSES[pose];
}
