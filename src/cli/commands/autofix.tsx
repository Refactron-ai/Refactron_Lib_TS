// src/cli/commands/autofix.tsx
import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import type { PipelineSession } from '../../core/models.js';
import { theme } from '../../ui/theme.js';

interface AutofixCommandProps {
  target: string;
  dryRun: boolean;
  verify: boolean;
  autofix: (
    target: string,
    options: { dryRun?: boolean; verify?: boolean },
  ) => Promise<PipelineSession>;
}

export function AutofixCommand({
  target,
  dryRun,
  verify,
  autofix,
}: AutofixCommandProps): React.ReactElement {
  const [session, setSession] = useState<PipelineSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    autofix(target, { dryRun, verify })
      .then((s) => {
        setSession(s);
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
        <Text color={theme.colors.accent}>
          {dryRun ? 'Previewing fixes' : 'Applying fixes'}
          {'  '}
        </Text>
        <Text color={theme.colors.textDim}>{target}</Text>
      </Box>
    );
  }

  if (error) {
    return <Text color={theme.colors.error}>Error: {error}</Text>;
  }

  if (!session) return <Text>No session</Text>;

  return (
    <Box flexDirection="column">
      <Text color={theme.colors.text} bold>
        {dryRun ? 'Dry Run Complete' : 'Autofix Complete'}
      </Text>
      <Text color={theme.colors.success}>
        {theme.symbols.pass} Applied: {session.appliedFixes.length}
      </Text>
      <Text color={theme.colors.error}>
        {theme.symbols.fail} Blocked: {session.blockedFixes.length}
      </Text>
      {session.blockedFixes.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={theme.colors.textDim}>Blocked fixes (verification prevented):</Text>
          {session.blockedFixes.map((fix) => (
            <Text key={fix.issueId} color={theme.colors.textDim}>
              {'  '}
              {theme.symbols.bullet} {fix.filePath}:{fix.lineNumber} — {fix.message}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}
