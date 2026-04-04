// src/cli/components/Banner.tsx
// Startup banner rendered once inside Ink's <Static> so it appears at the top
// of the terminal output and never re-renders.
//
// Layout (matches Claude Code's CondensedLogo side-by-side style):
//   [mascot row1]  Welcome to Refactron  v0.1.0-beta.1
//   [mascot row2]  TypeScript · PRO
//   [mascot row3]  user@email.com
//                  ~/path/to/project
//                  Type help for commands · Ctrl+C to exit
import React from 'react';
import { Box, Text } from 'ink';
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
  const mascot = getMascotRows('default');
  const cwd = truncateCwd(process.cwd());
  const subtitle = plan != null && plan !== ''
    ? `${adapterName} · ${plan.toUpperCase()}`
    : adapterName;

  return (
    <Box flexDirection="column" paddingBottom={1}>
      {/* Top rule */}
      <Text color={theme.colors.border}>{'─'.repeat(60)}</Text>

      {/* Side-by-side: mascot + info */}
      <Box flexDirection="row" gap={2} paddingTop={0}>
        {/* Left: mascot (3 rows) */}
        <Box flexDirection="column">
          <Text color={theme.colors.accent}>{mascot[0]}</Text>
          <Text color={theme.colors.accent}>{mascot[1]}</Text>
          <Text color={theme.colors.accent}>{mascot[2]}</Text>
        </Box>

        {/* Right: product info */}
        <Box flexDirection="column">
          {/* Row 1: name + version */}
          <Box gap={1}>
            <Text color={theme.colors.accent} bold>Welcome to Refactron</Text>
            <Text dimColor>v{version}</Text>
          </Box>

          {/* Row 2: adapter + plan */}
          <Text dimColor>{subtitle}</Text>

          {/* Row 3: email (if authed) or hint */}
          {email != null && email !== ''
            ? <Text dimColor>{email}</Text>
            : <Text dimColor>{cwd}</Text>
          }
        </Box>
      </Box>

      {/* Below mascot: cwd + hint */}
      {email != null && email !== '' && (
        <Text dimColor>  {cwd}</Text>
      )}
      <Text dimColor>  Type <Text color={theme.colors.accent}>help</Text> for commands · Ctrl+C to exit</Text>

      {/* Bottom rule */}
      <Text color={theme.colors.border}>{'─'.repeat(60)}</Text>
    </Box>
  );
}
