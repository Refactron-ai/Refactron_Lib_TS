// src/cli/components/StatusLine.tsx
// Always-visible bottom bar — adapter name, issue counts, session state, context %.
// Matches Claude Code's StatusLine: single row, dimmed, configurable sections.
import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../../ui/theme.js';

interface StatusLineProps {
  adapterName: string;
  version: string;
  issueCount?: number | undefined;
  criticalCount?: number | undefined;
  sessionState?: string | undefined;
  contextPct?: number | undefined; // 0–100
  isRunning?: boolean | undefined;
}

export function StatusLine({
  adapterName,
  version,
  issueCount,
  criticalCount,
  sessionState,
  contextPct,
  isRunning,
}: StatusLineProps): React.ReactElement {
  const hasCritical = (criticalCount ?? 0) > 0;

  return (
    <Box
      borderStyle="single"
      borderTop={true}
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      borderColor={theme.colors.border}
      paddingX={1}
      flexDirection="row"
      justifyContent="space-between"
    >
      {/* Left section: adapter + version */}
      <Box gap={1}>
        <Text color={theme.colors.accent} bold>
          refactron
        </Text>
        <Text color={theme.colors.textDim}>v{version}</Text>
        <Text color={theme.colors.border}>│</Text>
        <Text color={theme.colors.text}>{adapterName}</Text>
      </Box>

      {/* Center section: issue summary */}
      <Box gap={1}>
        {issueCount != null && (
          <>
            <Text color={hasCritical ? theme.colors.critical : theme.colors.textDim}>
              {hasCritical ? `${criticalCount ?? 0} critical` : `${issueCount} issues`}
            </Text>
          </>
        )}
        {sessionState && (
          <>
            <Text color={theme.colors.border}>│</Text>
            <Text color={theme.colors.textDim}>{sessionState}</Text>
          </>
        )}
      </Box>

      {/* Right section: running indicator + context % */}
      <Box gap={1}>
        {isRunning && <Text color={theme.colors.warning}>running</Text>}
        {contextPct != null && (
          <Text color={contextPct > 80 ? theme.colors.warning : theme.colors.textDim}>
            {contextPct}% ctx
          </Text>
        )}
        <Text color={theme.colors.textDim}>
          {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>
      </Box>
    </Box>
  );
}
