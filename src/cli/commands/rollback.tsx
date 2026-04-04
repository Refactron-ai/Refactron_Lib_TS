// src/cli/commands/rollback.tsx
import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { theme } from '../../ui/theme.js';

interface RollbackCommandProps {
  rollback: () => Promise<{ filesRestored: number }>;
}

export function RollbackCommand({ rollback }: RollbackCommandProps): React.ReactElement {
  const [result, setResult] = useState<{ filesRestored: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    rollback()
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
    return <Text color={theme.colors.accent}>Rolling back last session...</Text>;
  }

  if (error) {
    return <Text color={theme.colors.error}>Rollback failed: {error}</Text>;
  }

  return (
    <Box flexDirection="column">
      <Text color={theme.colors.success} bold>
        {theme.symbols.pass} Rollback complete
      </Text>
      <Text color={theme.colors.textDim}>Files restored: {result?.filesRestored ?? 0}</Text>
    </Box>
  );
}
