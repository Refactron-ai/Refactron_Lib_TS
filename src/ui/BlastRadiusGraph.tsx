// src/ui/BlastRadiusGraph.tsx
import React from 'react';
import { Box, Text } from 'ink';
import type { BlastRadius } from '../core/models.js';
import { theme } from './theme.js';

interface BlastRadiusGraphProps {
  blastRadius: BlastRadius;
  targetFile: string;
}

export function BlastRadiusGraph({
  blastRadius,
  targetFile,
}: BlastRadiusGraphProps): React.ReactElement {
  const barWidth = 20;
  const filled = Math.round((blastRadius.score / 100) * barWidth);
  const empty = barWidth - filled;
  const bar = theme.symbols.bar.repeat(filled) + theme.symbols.barEmpty.repeat(empty);
  const color = theme.blastColors[blastRadius.level];

  return (
    <Box flexDirection="column" padding={1}>
      <Text color={theme.colors.accent} bold>
        Blast Radius Graph — {targetFile}
      </Text>
      <Text color={theme.colors.border}>{'──────────────────────────────────────'}</Text>
      <Box>
        <Text color={color}>{bar}</Text>
        <Text color={theme.colors.textDim}>
          {'  '}
          {blastRadius.score}/100 — {blastRadius.level.toUpperCase()}
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color={theme.colors.textDim}>
          Affected files:{'     '}
          {blastRadius.affectedFiles.length}
        </Text>
        <Text color={theme.colors.textDim}>
          Affected functions:{' '}
          {blastRadius.affectedFunctions.length}
        </Text>
        <Text color={theme.colors.textDim}>
          Test files at risk:{' '}
          {blastRadius.affectedTestFiles.length}
        </Text>
      </Box>
      {blastRadius.affectedFiles.slice(0, 5).map((f, i) => (
        <Text key={i} color={theme.colors.textDim}>
          {'  '}
          {theme.symbols.bullet} {f}
        </Text>
      ))}
      {blastRadius.affectedFiles.length > 5 && (
        <Text color={theme.colors.textDim}>
          {'  '}... and {blastRadius.affectedFiles.length - 5} more
        </Text>
      )}
    </Box>
  );
}
