// src/ui/DiffView.tsx
import React from 'react';
import { Box, Text } from 'ink';
import { theme } from './theme.js';

interface DiffViewProps {
  diff: string;
  filePath: string;
}

export function DiffView({ diff, filePath }: DiffViewProps): React.ReactElement {
  const lines = diff.split('\n').slice(0, 40);
  return (
    <Box flexDirection="column" padding={1}>
      <Text color={theme.colors.accent} bold>
        Diff — {filePath}
      </Text>
      <Text color={theme.colors.border}>{'──────────────────────────────────────'}</Text>
      {lines.map((line, i) => {
        if (line.startsWith('+') && !line.startsWith('+++')) {
          return (
            <Text key={i} color={theme.colors.success}>
              {line}
            </Text>
          );
        }
        if (line.startsWith('-') && !line.startsWith('---')) {
          return (
            <Text key={i} color={theme.colors.error}>
              {line}
            </Text>
          );
        }
        if (line.startsWith('@@')) {
          return (
            <Text key={i} color={theme.colors.accent}>
              {line}
            </Text>
          );
        }
        return (
          <Text key={i} color={theme.colors.textDim}>
            {line}
          </Text>
        );
      })}
    </Box>
  );
}
