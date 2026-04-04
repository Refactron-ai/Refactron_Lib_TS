// src/ui/IssueDetail.tsx
import React from 'react';
import { Box, Text } from 'ink';
import type { CodeIssue } from '../core/models.js';
import { theme } from './theme.js';

interface IssueDetailProps {
  issue: CodeIssue;
}

export function IssueDetail({ issue }: IssueDetailProps): React.ReactElement {
  const severityColor = theme.severityColors[issue.severity];
  const blastColor = theme.blastColors[issue.blastRadius.level];

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.colors.border} padding={1}>
      <Text color={severityColor} bold>
        {issue.severity.toUpperCase()} — {issue.type}
      </Text>
      <Text color={theme.colors.text}>{issue.message}</Text>
      <Text color={theme.colors.textDim}>
        {issue.file}:{issue.line}
      </Text>
      {issue.suggestion && (
        <Text color={theme.colors.accent}>
          {theme.symbols.arrow} {issue.suggestion}
        </Text>
      )}
      <Box marginTop={1} flexDirection="column">
        <Text color={blastColor} bold>
          Blast Radius: {issue.blastRadius.level.toUpperCase()} (score: {issue.blastRadius.score}
          /100)
        </Text>
        <Text color={theme.colors.textDim}>
          {issue.blastRadius.affectedFiles.length} files ·{' '}
          {issue.blastRadius.affectedFunctions.length} functions ·{' '}
          {issue.blastRadius.affectedTestFiles.length} test files
        </Text>
      </Box>
    </Box>
  );
}
