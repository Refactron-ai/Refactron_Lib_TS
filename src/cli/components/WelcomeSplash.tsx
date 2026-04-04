// src/cli/components/WelcomeSplash.tsx
// Open borderless welcome screen shown in LoginFlow (before auth).
// Layout: sparse starfield bg · big pixel-R brand mark (right) · mascot (lower-left, brand color)
import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../../ui/theme.js';

const WELCOME_WIDTH = 58;

// U+2026 HORIZONTAL ELLIPSIS × 58
const SEP = '\u2026'.repeat(WELCOME_WIDTH);

// ── Pixel "R" — positioned right-of-center, 6 cols wide ───────────────────
// Rendered as plain (dim) text so it doesn't compete with the brand-blue mascot.
//
//   ▐████▖
//   ▐▌  ▐▌
//   ▐████▘
//   ▐▌ ▀█▌
//   ▐▌  ▀█
//
// Each art row is 58 chars total (spaces pad left/right).

const ART: string[] = [
  // col:  0         1         2         3         4         5
  //       0123456789012345678901234567890123456789012345678901234567
  '                                                          ',
  '  \u00b7                       \u2590\u2588\u2588\u2588\u2588\u2596                        ',
  '                            \u2590\u258c  \u2590\u258c    \u00b7               ',
  '       \u00b7                  \u2590\u2588\u2588\u2588\u2588\u2598         *             ',
  '  *                         \u2590\u258c \u2580\u2588\u258c                      ',
  '             \u00b7              \u2590\u258c  \u2580\u2588         \u00b7             ',
];

// Mascot rows in brand color — bot sits lower-left
const M0 = '  \u2597\u2584\u2588\u2588\u2588\u2588\u2584\u2596                                      '; // ▗▄████▄▖
const M1 = '  \u2590\u258c \u2584\u2584 \u2590\u258c                                      '; // ▐▌ ▄▄ ▐▌
const M2 = '   \u259d\u2518  \u259d\u2518                                       '; //  ▝▘  ▝▘

// Bottom separator row: mascot top-row embedded in ellipsis stream
const BOT_SEP =
  '\u2026\u2026 \u2597\u2584\u2588\u2588\u2588\u2588\u2584\u2596 ' +
  '\u2026'.repeat(WELCOME_WIDTH - 12);

interface WelcomeSplashProps {
  version: string;
}

export function WelcomeSplash({ version }: WelcomeSplashProps): React.ReactElement {
  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Title */}
      <Text>
        <Text color={theme.colors.brand} bold>{'Welcome to Refactron'}</Text>
        {'  '}
        <Text dimColor>{'v'}{version}</Text>
      </Text>

      {/* Top separator */}
      <Text dimColor>{SEP}</Text>

      {/* Starfield + pixel-R background (plain / dim) */}
      {ART.map((row, i) => (
        <Text key={i} dimColor>{row}</Text>
      ))}

      {/* Mascot — brand blue, lower-left */}
      <Text color={theme.colors.brand}>{M0}</Text>
      <Text color={theme.colors.brand}>{M1}</Text>
      <Text color={theme.colors.brand}>{M2}</Text>

      {/* Bottom separator */}
      <Text dimColor>{SEP}</Text>

      {/* Footer row: mascot body peek + dots */}
      <Text color={theme.colors.brand}>{BOT_SEP}</Text>
    </Box>
  );
}
