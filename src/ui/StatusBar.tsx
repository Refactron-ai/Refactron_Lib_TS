// src/ui/StatusBar.tsx
import React from 'react';
import { Box, Text } from 'ink';
import { theme } from './theme.js';

interface StatusBarProps {
  critical: number;
  high: number;
  medium: number;
  low: number;
  fixable: number;
}

export function StatusBar({
  critical,
  high,
  medium,
  low,
  fixable,
}: StatusBarProps): React.ReactElement {
  return (
    <Box borderStyle="single" borderColor={theme.colors.border} paddingX={1}>
      <Text color={theme.colors.critical} bold>
        {critical} critical
      </Text>
      <Text color={theme.colors.textDim}>{'  ·  '}</Text>
      <Text color={theme.colors.high}>{high} high</Text>
      <Text color={theme.colors.textDim}>{'  ·  '}</Text>
      <Text color={theme.colors.medium}>{medium} medium</Text>
      <Text color={theme.colors.textDim}>{'  ·  '}</Text>
      <Text color={theme.colors.low}>{low} low</Text>
      <Text color={theme.colors.textDim}>{'  ·  '}</Text>
      <Text color={theme.colors.accent}>{fixable} autofixable</Text>
    </Box>
  );
}
