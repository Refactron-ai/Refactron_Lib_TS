// src/cli/components/StatusLine.tsx
// Single-row status line below the prompt — matches Claude Code's StatusLine
// style: no border box, plain dimmed text with · separators.
// Shows: ◈ refactron · adapter · version · [issues] · [running] · time
import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../../ui/theme.js';

interface StatusLineProps {
  adapterName: string;
  version: string;
  issueCount?: number | undefined;
  criticalCount?: number | undefined;
  sessionState?: string | undefined;
  isRunning?: boolean | undefined;
}

const SEP = <Text dimColor> · </Text>;

export function StatusLine({
  adapterName,
  version,
  issueCount,
  criticalCount,
  sessionState,
  isRunning,
}: StatusLineProps): React.ReactElement {
  const hasCritical = (criticalCount ?? 0) > 0;
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <Box paddingLeft={1} paddingTop={0}>
      {/* Diamond symbol — matches Claude Code's ◆ separator */}
      <Text color={theme.colors.accent}>◈</Text>
      <Text dimColor> refactron </Text>
      {SEP}
      <Text dimColor>{adapterName}</Text>
      {SEP}
      <Text dimColor>v{version}</Text>

      {/* Issue summary — only shown after analysis */}
      {issueCount != null && (
        <>
          {SEP}
          <Text color={hasCritical ? theme.colors.critical : theme.colors.textDim}>
            {hasCritical ? `${criticalCount ?? 0} critical` : `${issueCount} issues`}
          </Text>
        </>
      )}

      {/* Session state (ANALYZING / FIXING / FIXED) */}
      {sessionState != null && sessionState !== '' && (
        <>
          {SEP}
          <Text dimColor>{sessionState.toLowerCase()}</Text>
        </>
      )}

      {/* Running indicator */}
      {isRunning === true && (
        <>
          {SEP}
          <Text color={theme.colors.warning}>running…</Text>
        </>
      )}

      {SEP}
      <Text dimColor>{time}</Text>
    </Box>
  );
}
