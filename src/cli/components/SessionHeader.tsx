// src/cli/components/SessionHeader.tsx
// YRC CondensedLogo-equivalent: 3-row compact header shown once at top of REPL session.
// Mascot (9 cols) on the left, version/adapter/cwd text on the right — no box borders.
//
// Renders:
//   ▐▛███▜▌   Refactron  v0.1.0
//   ▝▜█████▛▘  Python · FREE
//     ▘▘ ▝▝    ~/my-project
import React from 'react';
import { Box, Text, useStdout } from 'ink';
import { theme } from '../../ui/theme.js';
import { getMascotRows } from './Mascot.js';

interface SessionHeaderProps {
  version: string;
  adapterName: string;
  email?: string | null | undefined;
  plan?: string | null | undefined;
}

function truncatePath(p: string, maxLen: number): string {
  const home = process.env['HOME'] ?? process.env['USERPROFILE'] ?? '';
  const rel = home && p.startsWith(home) ? '~' + p.slice(home.length) : p;
  if (rel.length <= maxLen) return rel;
  const parts = rel.split('/');
  return '\u2026/' + parts.slice(-2).join('/');
}

export function SessionHeader({
  version,
  adapterName,
  plan,
}: SessionHeaderProps): React.ReactElement {
  const { stdout } = useStdout();
  const columns = stdout?.columns ?? 80;

  const mascot = getMascotRows('default');
  const subtitle = plan ? `${adapterName} \u00b7 ${plan.toUpperCase()}` : adapterName;
  const cwdMaxWidth = Math.max(columns - 15, 20); // YRC: Math.max(columns - 15, 20)
  const cwd = truncatePath(process.cwd(), cwdMaxWidth);

  return (
    <Box flexDirection="row" marginBottom={1}>
      {/* Mascot — 3 rows, 9 cols wide (matches Clawd dimensions exactly) */}
      <Box flexDirection="column" marginRight={2}>
        <Text color={theme.colors.brand}>{mascot[0]}</Text>
        <Text color={theme.colors.brand}>{mascot[1]}</Text>
        <Text color={theme.colors.brand}>{mascot[2]}</Text>
      </Box>

      {/* Info rows — YRC CondensedLogo right column */}
      <Box flexDirection="column">
        {/* Row 1: product name (bold) + version (dim) */}
        <Text>
          <Text bold>{'Refactron'}</Text>
          {'  '}
          <Text dimColor>{'v'}{version}</Text>
        </Text>
        {/* Row 2: adapter · plan */}
        <Text dimColor>{subtitle}</Text>
        {/* Row 3: cwd */}
        <Text dimColor>{cwd}</Text>
      </Box>
    </Box>
  );
}
