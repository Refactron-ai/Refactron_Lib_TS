// src/cli/components/BannerLogo.tsx
// Startup banner — replicates CondensedLogo from Claude Code.
// Layout: [AnimatedMascot] + right column with product name, adapter, cwd, hint.
// Rendered as a live React component (not Static text) so the mascot can animate.
import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../../ui/theme.js';
import { AnimatedMascot } from './AnimatedMascot.js';

interface BannerLogoProps {
  version: string;
  adapterName: string;
  email?: string | null | undefined;
  plan?: string | null | undefined;
}

function truncateCwd(p: string, maxLen: number): string {
  const home = process.env['HOME'] ?? process.env['USERPROFILE'] ?? '';
  const withTilde = home && p.startsWith(home) ? '~' + p.slice(home.length) : p;
  if (withTilde.length <= maxLen) return withTilde;
  // Keep last two path segments with … prefix
  const parts = withTilde.split('/');
  return '…/' + parts.slice(-2).join('/');
}

export function BannerLogo({
  version,
  adapterName,
  email,
  plan,
}: BannerLogoProps): React.ReactElement {
  const cwd = truncateCwd(process.cwd(), 45);
  const planLabel = plan ? ` · ${plan.toUpperCase()}` : '';
  const subtitle = `${adapterName}${planLabel}`;

  return (
    <Box
      flexDirection="row"
      gap={2}
      alignItems="flex-start"
      paddingLeft={1}
      marginBottom={1}
    >
      <AnimatedMascot />

      <Box flexDirection="column">
        {/* Product name + version — matches "Claude Code v1.x" */}
        <Text>
          <Text bold color={theme.colors.accent}>
            Refactron
          </Text>{' '}
          <Text dimColor>v{version}</Text>
        </Text>

        {/* Adapter + plan — matches model · billing */}
        <Text dimColor>{subtitle}</Text>

        {/* Authenticated user email */}
        {email != null && email !== '' && <Text dimColor>{email}</Text>}

        {/* Working directory */}
        <Text dimColor>{cwd}</Text>

        {/* Hint line — matches Claude Code's "Type /help…" hint */}
        <Text dimColor>Type help · Ctrl+C to exit</Text>
      </Box>
    </Box>
  );
}
