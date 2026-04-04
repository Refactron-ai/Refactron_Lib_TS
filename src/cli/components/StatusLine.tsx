// src/cli/components/StatusLine.tsx
// Single dimColor row — YRC StatusLine equivalent.
// ◈ refactron · adapter · version · [issues] · [state] · [running] · [ctx%] · time
// No border box, wrap=truncate, paddingX for symmetric padding.
import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../../ui/theme.js';

interface StatusLineProps {
  adapterName: string;
  version: string;
  issueCount?: number | undefined;
  criticalCount?: number | undefined;
  sessionState?: string | undefined;
  contextPct?: number | undefined;
  isRunning?: boolean | undefined;
}

const SEP = <Text dimColor> · </Text>;

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
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <Box paddingX={1} height={1}>
      <Text wrap="truncate">
        <Text color={theme.colors.brand}>{'◈'}</Text>
        <Text dimColor>{' refactron '}</Text>
        {SEP}
        <Text dimColor>{adapterName}</Text>
        {SEP}
        <Text dimColor>{'v'}{version}</Text>

        {issueCount != null && (
          <>
            {SEP}
            <Text color={hasCritical ? theme.colors.critical : theme.colors.textDim}>
              {hasCritical ? `${criticalCount ?? 0} critical` : `${issueCount} issues`}
            </Text>
          </>
        )}

        {sessionState != null && sessionState !== '' && (
          <>
            {SEP}
            <Text dimColor>{sessionState.toLowerCase()}</Text>
          </>
        )}

        {isRunning === true && (
          <>
            {SEP}
            <Text color={theme.colors.warning}>{'running…'}</Text>
          </>
        )}

        {contextPct != null && (
          <>
            {SEP}
            <Text color={contextPct > 80 ? theme.colors.warning : theme.colors.textDim}>
              {contextPct}{'% ctx'}
            </Text>
          </>
        )}

        {SEP}
        <Text dimColor>{time}</Text>
      </Text>
    </Box>
  );
}
