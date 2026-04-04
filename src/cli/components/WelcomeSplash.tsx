// src/cli/components/WelcomeSplash.tsx
// Open borderless welcome screen shown in LoginFlow (before auth).
// Layout:
//   · sparse starfield + code symbols (dim bg)
//   · large pixel-R brand mark, pure full-block chars only (no half-blocks → no render glitch)
//   · mascot lower-left in brand blue
import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../../ui/theme.js';

const WELCOME_WIDTH = 72;
const SEP = '\u2026'.repeat(WELCOME_WIDTH); // … × 72

// ── Pixel "R" — pure █ + space, 7 cols × 7 rows ──────────────────────────
//
//   ██████
//   █    █
//   █    █
//   ██████
//   █  █
//   █   █
//   █    █
//
// Positioned starting at column 32 in each row (0-indexed).
// Surrounding content: sparse stars (·/*) and code symbols ({} </> //)

const ART: string[] = [
  //          1111111111222222222233333333334444444444555555555566666666667777
  // 01234567890123456789012345678901234567890123456789012345678901234567890123
  '                                                                        ',
  '  \u00b7              \u00b7                 \u2588\u2588\u2588\u2588\u2588\u2588                  \u00b7            ',
  '                                   \u2588    \u2588                  *          ',
  '        *             \u00b7            \u2588    \u2588                             ',
  '  \u00b7                               \u2588\u2588\u2588\u2588\u2588\u2588              \u00b7               ',
  '                   *               \u2588  \u2588         {  }                 ',
  '         \u00b7                         \u2588   \u2588                  *          ',
  '  *              \u00b7                 \u2588    \u2588         </>              \u00b7',
  '                                                                        ',
  '         \u00b7                   //         \u00b7                \u00b7             ',
];

// Mascot rows — brand blue, lower-left
// ▗▄████▄▖  ▐▌ ▄▄ ▐▌   ▝▘  ▝▘
const M0 = '  \u2597\u2584\u2588\u2588\u2588\u2588\u2584\u2596                                                     ';
const M1 = '  \u2590\u258c \u2584\u2584 \u2590\u258c                                                     ';
const M2 = '   \u259d\u2518  \u259d\u2518                                                      ';

// Footer row: mascot head embedded in ellipsis stream
const BOT_SEP = '\u2026\u2026 \u2597\u2584\u2588\u2588\u2588\u2588\u2584\u2596 ' + '\u2026'.repeat(WELCOME_WIDTH - 12);

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

      {/* Background: starfield + code symbols (dim) + pixel R (dim) */}
      {ART.map((row, i) => (
        <Text key={i} dimColor>{row}</Text>
      ))}

      {/* Mascot — brand blue */}
      <Text color={theme.colors.brand}>{M0}</Text>
      <Text color={theme.colors.brand}>{M1}</Text>
      <Text color={theme.colors.brand}>{M2}</Text>

      {/* Bottom separator */}
      <Text dimColor>{SEP}</Text>

      {/* Footer: mascot peek + dot stream */}
      <Text color={theme.colors.brand}>{BOT_SEP}</Text>
    </Box>
  );
}
