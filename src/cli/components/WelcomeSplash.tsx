// src/cli/components/WelcomeSplash.tsx
// Full-box welcome screen — YRC WelcomeV2 equivalent.
// Rendered once inside <Static> so it appears at the very top and never
// re-renders. Uses box-drawing borders + mascot + info.
import React from 'react';
import { Box, Text, useStdout } from 'ink';
import { theme } from '../../ui/theme.js';
import { getMascotRows } from './Mascot.js';

interface WelcomeSplashProps {
  version: string;
  adapterName: string;
  email?: string | null | undefined;
  plan?: string | null | undefined;
}

function truncateCwd(p: string, maxLen: number): string {
  const home = process.env['HOME'] ?? process.env['USERPROFILE'] ?? '';
  const rel = home && p.startsWith(home) ? '~' + p.slice(home.length) : p;
  if (rel.length <= maxLen) return rel;
  const parts = rel.split('/');
  return '…/' + parts.slice(-2).join('/');
}

// Pad a string to exactly `len` chars with spaces
function pad(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len) : s + ' '.repeat(len - s.length);
}

// Sparkle positions (col offsets from mascot area) — fixed, matches YRC asterisk pattern
const SPARKLES: Array<{ row: number; col: number }> = [
  { row: 0, col: 0 },
  { row: 0, col: 7 },
  { row: 1, col: 13 },
  { row: 2, col: 2 },
];

export function WelcomeSplash({
  version,
  adapterName,
  email,
  plan,
}: WelcomeSplashProps): React.ReactElement {
  const { stdout } = useStdout();
  const termCols = stdout?.columns ?? 80;
  // Box inner width: clamp between 52 and 66
  const innerW = Math.min(Math.max(termCols - 6, 52), 66);

  const mascot = getMascotRows('default');
  const cwd = truncateCwd(process.cwd(), innerW - 16);
  const subtitle =
    plan != null && plan !== ''
      ? `${adapterName} · ${plan.toUpperCase()}`
      : adapterName;
  const emailLine = email != null && email !== '' ? email : null;

  // Build content rows: each is [leftPad, content, accent?]
  // Mascot is 9 chars wide; info starts at col 13 (9 + 4 gap)
  const infoCol = 13;
  const infoW = innerW - infoCol - 2; // 2 for border padding

  // Row builders
  const empty = () => `  ${' '.repeat(innerW)}`;
  const mascotRow = (mRow: string, info: string, accent = false) => {
    const infoStr = pad(info, infoW);
    return { mRow, infoStr, accent };
  };

  const rows = [
    mascotRow(mascot[0] ?? '', `Welcome to Refactron`, true),
    mascotRow(mascot[1] ?? '', `Safety-first AI refactoring`),
    mascotRow(mascot[2] ?? '', `v${version}`),
  ];

  const border = theme.colors.border;
  const brand = theme.colors.brand;
  const dim = theme.colors.textDim;

  const top = `╭${'─'.repeat(innerW + 2)}╮`;
  const bot = `╰${'─'.repeat(innerW + 2)}╯`;
  const blankLine = `│${' '.repeat(innerW + 2)}│`;

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Top border */}
      <Text color={border}>{top}</Text>
      <Text color={border}>{blankLine}</Text>

      {/* Mascot + info rows */}
      {rows.map((r, i) => (
        <Box key={i} flexDirection="row">
          <Text color={border}>{'│  '}</Text>
          {/* Sparkle before mascot on row 0 */}
          {i === 0 && <Text color={dim}>{'* '}</Text>}
          {i !== 0 && <Text>{'  '}</Text>}
          <Text color={brand}>{r.mRow}</Text>
          <Text>{'   '}</Text>
          {r.accent ? (
            <Text color={brand} bold>{pad(r.infoStr, infoW)}</Text>
          ) : (
            <Text dimColor>{pad(r.infoStr, infoW)}</Text>
          )}
          <Text color={border}>{'  │'}</Text>
        </Box>
      ))}

      {/* Separator */}
      <Text color={border}>{blankLine}</Text>

      {/* Metadata lines */}
      <Box flexDirection="row">
        <Text color={border}>{'│  '}</Text>
        <Text dimColor>{pad(subtitle, innerW - 2)}</Text>
        <Text color={border}>{'  │'}</Text>
      </Box>

      {emailLine != null && (
        <Box flexDirection="row">
          <Text color={border}>{'│  '}</Text>
          <Text dimColor>{pad(emailLine, innerW - 2)}</Text>
          <Text color={border}>{'  │'}</Text>
        </Box>
      )}

      <Box flexDirection="row">
        <Text color={border}>{'│  '}</Text>
        <Text dimColor>{pad(cwd, innerW - 2)}</Text>
        <Text color={border}>{'  │'}</Text>
      </Box>

      {/* Blank + hint */}
      <Text color={border}>{blankLine}</Text>
      <Box flexDirection="row">
        <Text color={border}>{'│  '}</Text>
        <Text dimColor>{'Type '}</Text>
        <Text color={brand}>{'help'}</Text>
        <Text dimColor>{pad(' for commands · Ctrl+C to exit', innerW - 10)}</Text>
        <Text color={border}>{'  │'}</Text>
      </Box>

      {/* Bottom border */}
      <Text color={border}>{blankLine}</Text>
      <Text color={border}>{bot}</Text>
    </Box>
  );
}
