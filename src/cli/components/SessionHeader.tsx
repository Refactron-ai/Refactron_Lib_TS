// src/cli/components/SessionHeader.tsx
// Compact header shown once at the top of a REPL session.
// Tabslot on the left, version/adapter/cwd text on the right — no box borders.
//
// Renders:
//        ▄▄
//    ▄▄▄▄██▄▄▄▄
//   ██▀██████▀██   Refactron  v0.3.0
//   ██▄██████▄██   Python · FREE
//   ▀██████████▀   ~/my-project
//   ████████████
//    ▀▀▀▀▀▀▀▀▀▀
//
// The mascot is 7 rows and the text is 3, so the text is centred against it
// rather than top-aligned. Tabslot has exactly one size in a terminal: the
// sprite is 14 cells across and cannot be halved without redrawing it, and the
// brand forbids that. This header renders once into scrollback, not per turn,
// so the extra rows cost nothing after the first screen.
import React from 'react';
import { Box, Text, useStdout } from 'ink';
import { getMascotRows, MascotLine } from './Mascot.js';

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

  const mascot = getMascotRows();
  const subtitle = plan ? `${adapterName} \u00b7 ${plan.toUpperCase()}` : adapterName;
  const cwdMaxWidth = Math.max(columns - 15, 20); // YRC: Math.max(columns - 15, 20)
  const cwd = truncatePath(process.cwd(), cwdMaxWidth);

  return (
    <Box flexDirection="row" alignItems="center" marginBottom={1}>
      {/* Tabslot — 7 rows, 14 cols. SAFE is the identity mark here, not a verdict. */}
      <Box flexDirection="column" marginRight={2}>
        {mascot.map((row, i) => (
          <MascotLine key={i} row={row} />
        ))}
      </Box>

      {/* Info rows — centred against the taller mascot by alignItems above */}
      <Box flexDirection="column">
        {/* Row 1: product name (bold) + version (dim) */}
        <Text>
          <Text bold>{'Refactron'}</Text>
          {'  '}
          <Text dimColor>
            {'v'}
            {version}
          </Text>
        </Text>
        {/* Row 2: adapter · plan */}
        <Text dimColor>{subtitle}</Text>
        {/* Row 3: cwd */}
        <Text dimColor>{cwd}</Text>
      </Box>
    </Box>
  );
}
