// src/ui/ProgressBar.tsx
import React from 'react';
import { Box, Text } from 'ink';
import { theme } from './theme.js';

interface ProgressBarProps {
  total: number;
  current: number;
  width?: number;
  label?: string;
}

export function ProgressBar({
  total,
  current,
  width = 20,
  label,
}: ProgressBarProps): React.ReactElement {
  const pct = total === 0 ? 0 : Math.min(current / total, 1);
  const filled = Math.round(pct * width);
  const empty = width - filled;
  const bar = theme.symbols.bar.repeat(filled) + theme.symbols.barEmpty.repeat(empty);
  const pctStr = Math.round(pct * 100).toString().padStart(3, ' ');

  return (
    <Box>
      {label && <Text color={theme.colors.textDim}>{label}  </Text>}
      <Text color={theme.colors.accent}>{bar}</Text>
      <Text color={theme.colors.textDim}>
        {'  '}
        {pctStr}%{'  '}
        {current}/{total}
      </Text>
    </Box>
  );
}
