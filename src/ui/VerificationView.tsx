// src/ui/VerificationView.tsx
import React from 'react';
import { Box, Text } from 'ink';
import type { VerificationResult } from '../core/models.js';
import { theme } from './theme.js';

interface VerificationViewProps {
  result: VerificationResult;
  filePath: string;
}

export function VerificationView({ result, filePath }: VerificationViewProps): React.ReactElement {
  return (
    <Box flexDirection="column" padding={1}>
      <Text color={theme.colors.text} bold>
        Verifying {filePath}
      </Text>
      <Text color={theme.colors.border}>{'──────────────────────────────────────'}</Text>
      {result.checksRun.map((check) => {
        const passed = result.checksPassed.includes(check);
        return (
          <Box key={check}>
            <Text color={passed ? theme.colors.success : theme.colors.error}>
              {passed ? theme.symbols.pass : theme.symbols.fail}
              {'  '}
              {check.padEnd(20)}
            </Text>
          </Box>
        );
      })}
      <Box marginTop={1} flexDirection="column">
        <Text color={theme.colors.textDim}>
          Confidence {Math.round(result.confidenceScore * 100)}%
        </Text>
        <Text color={result.safeToApply ? theme.colors.success : theme.colors.error} bold>
          {result.safeToApply
            ? 'Safe to apply'
            : `Blocked — ${result.blockingReason ?? 'verification failed'}`}
        </Text>
      </Box>
    </Box>
  );
}
