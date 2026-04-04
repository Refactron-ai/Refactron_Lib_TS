// src/cli/commands/status.tsx
import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import type { PipelineSession } from '../../core/models.js';
import { theme } from '../../ui/theme.js';

interface StatusCommandProps {
  getStatus: () => Promise<PipelineSession | null>;
}

export function StatusCommand({ getStatus }: StatusCommandProps): React.ReactElement {
  const [session, setSession] = useState<PipelineSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getStatus()
      .then((s) => {
        setSession(s);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return <Text color={theme.colors.textDim}>Loading session...</Text>;
  }

  if (!session) {
    return (
      <Text color={theme.colors.textDim}>
        No session found. Run: refactron analyze &lt;target&gt;
      </Text>
    );
  }

  return (
    <Box flexDirection="column">
      <Text color={theme.colors.accent} bold>
        Session {session.sessionId}
      </Text>
      <Text color={theme.colors.text}>
        State: {session.state} | Target: {session.target}
      </Text>
      <Text color={theme.colors.text}>
        Issues: {session.totalIssues} | Files: {session.totalFiles}
      </Text>
      <Text color={theme.colors.success}>Applied: {session.appliedFixes.length}</Text>
      <Text color={theme.colors.error}>Blocked: {session.blockedFixes.length}</Text>
      <Text color={theme.colors.textDim}>
        Created: {new Date(session.createdAt).toLocaleString()}
      </Text>
    </Box>
  );
}
