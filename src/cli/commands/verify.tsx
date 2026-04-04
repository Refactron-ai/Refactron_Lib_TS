// src/cli/commands/verify.tsx
import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import type { VerificationResult } from '../../core/models.js';
import { VerificationView } from '../../ui/VerificationView.js';
import { theme } from '../../ui/theme.js';

interface VerifyCommandProps {
  filePath: string;
  verify: (filePath: string) => Promise<VerificationResult>;
}

export function VerifyCommand({ filePath, verify }: VerifyCommandProps): React.ReactElement {
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    verify(filePath)
      .then((r) => {
        setResult(r);
        setLoading(false);
      })
      .catch((e: unknown) => {
        setError(String(e));
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <Box>
        <Text color={theme.colors.accent}>Verifying  </Text>
        <Text color={theme.colors.textDim}>{filePath}</Text>
      </Box>
    );
  }

  if (error) {
    return <Text color={theme.colors.error}>Error: {error}</Text>;
  }

  if (!result) return <Text>No result</Text>;

  return <VerificationView result={result} filePath={filePath} />;
}
