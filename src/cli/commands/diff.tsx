// src/cli/commands/diff.tsx
import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { DiffView } from '../../ui/DiffView.js';
import { theme } from '../../ui/theme.js';

interface DiffCommandProps {
  target: string;
  getDiff: (target: string) => Promise<{ diff: string; filePath: string } | null>;
}

export function DiffCommand({ target, getDiff }: DiffCommandProps): React.ReactElement {
  const [result, setResult] = useState<{ diff: string; filePath: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDiff(target)
      .then((r) => {
        setResult(r);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return <Text color={theme.colors.textDim}>Loading diff...</Text>;
  }

  if (!result) {
    return (
      <Box flexDirection="column">
        <Text color={theme.colors.textDim}>No diff available for {target}</Text>
        <Text color={theme.colors.textDim}>Run: refactron autofix {target} --dry-run</Text>
      </Box>
    );
  }

  return <DiffView diff={result.diff} filePath={result.filePath} />;
}
