// src/cli/components/Banner.tsx
// Condensed session banner — YRC CondensedLogo equivalent.
// Rendered once in <Static> so it sits at the top of the session output.
// Shows mascot + product name + adapter + plan + email + cwd.
import React from 'react';
import { Box, Text, useStdout } from 'ink';
import { theme } from '../../ui/theme.js';
import { getMascotRows } from './Mascot.js';

interface BannerProps {
  version: string;
  adapterName: string;
  email?: string | null | undefined;
  plan?: string | null | undefined;
}

function truncateCwd(p: string, maxLen = 50): string {
  const home = process.env['HOME'] ?? process.env['USERPROFILE'] ?? '';
  const rel = home && p.startsWith(home) ? '~' + p.slice(home.length) : p;
  if (rel.length <= maxLen) return rel;
  const parts = rel.split('/');
  return '…/' + parts.slice(-2).join('/');
}

export function Banner({ version, adapterName, email, plan }: BannerProps): React.ReactElement {
  const { stdout } = useStdout();
  const cols = stdout?.columns ?? 80;
  const ruleWidth = Math.min(cols, 80);
  const rule = '─'.repeat(ruleWidth);

  const mascot = getMascotRows('default');
  const cwd = truncateCwd(process.cwd(), 45);
  const subtitle =
    plan != null && plan !== ''
      ? `${adapterName} · ${plan.toUpperCase()}`
      : adapterName;

  return (
    <Box flexDirection="column" paddingBottom={1}>
      <Text color={theme.colors.border}>{rule}</Text>

      <Box flexDirection="row" gap={2} paddingTop={0} alignItems="flex-start">
        {/* Mascot — foreground only, no backgroundColor */}
        <Box flexDirection="column">
          <Text color={theme.colors.brand}>{mascot[0]}</Text>
          <Text color={theme.colors.brand}>{mascot[1]}</Text>
          <Text color={theme.colors.brand}>{mascot[2]}</Text>
        </Box>

        {/* Info column */}
        <Box flexDirection="column">
          <Box gap={1}>
            <Text color={theme.colors.brand} bold>Refactron</Text>
            <Text dimColor>v{version}</Text>
          </Box>
          <Text dimColor>{subtitle}</Text>
          {email != null && email !== ''
            ? <Text dimColor>{email}</Text>
            : <Text dimColor>{cwd}</Text>
          }
          {email != null && email !== '' && (
            <Text dimColor>{cwd}</Text>
          )}
        </Box>
      </Box>

      <Text color={theme.colors.border}>{rule}</Text>
    </Box>
  );
}
