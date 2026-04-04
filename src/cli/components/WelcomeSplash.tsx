// src/cli/components/WelcomeSplash.tsx
// YRC WelcomeV2-equivalent: open borderless layout, fixed 58-char width.
// Shown in LoginFlow (before auth). No box borders — exactly like Claude Code's startup screen.
import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../../ui/theme.js';

const WELCOME_WIDTH = 58; // matches YRC WELCOME_V2_WIDTH

// U+2026 HORIZONTAL ELLIPSIS repeated — one char, not three dots
const SEP = '\u2026'.repeat(WELCOME_WIDTH);

// ASCII art rows: background block shapes + scattered stars + mascot
// Each row is padded to WELCOME_WIDTH chars, plain text (no color override on bg shapes)
const ART_ROWS_PLAIN = [
  '                                                          ',
  '     *                              \u2588\u2588\u2588\u2588\u2588\u2593\u2593\u2591              ',
  '                    *            \u2588\u2588\u2588\u2593\u2591     \u2591\u2591             ',
  '          \u2591\u2591\u2591\u2591\u2591\u2591                 \u2588\u2588\u2588\u2593\u2591                    ',
  '    \u2591\u2591\u2591   \u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591             \u2588\u2588\u2588\u2593\u2591                    ',
  '   \u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591   *      \u2588\u2588\u2593\u2591\u2591      \u2591             ',
  '                                  \u2591\u2593\u2593\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2593\u2591             ',
];

// Mascot rows (rendered in brand color)  — "Refactron Bot" design
const MASCOT_ROW_0 = '      \u2597\u2584\u2588\u2588\u2588\u2588\u2584\u2596 ';  // "▗▄████▄▖" padded
const MASCOT_ROW_1 = '      \u2590\u258c \u2584\u2584 \u2590\u258c';           // "▐▌ ▄▄ ▐▌"
const MASCOT_ROW_2 = '       \u259d\u2518  \u259d\u2518  ';                   // " ▝▘  ▝▘ "

// Bottom separator: mascot body embedded in ellipsis dots
const BOT_SEP =
  '\u2026\u2026\u2026 \u2597\u2584\u2588\u2588\u2588\u2588\u2584\u2596 \u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2591\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2591\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026';

interface WelcomeSplashProps {
  version: string;
}

export function WelcomeSplash({ version }: WelcomeSplashProps): React.ReactElement {
  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Title line */}
      <Text>
        <Text color={theme.colors.brand}>{'Welcome to Refactron'}</Text>
        {'  '}
        <Text dimColor>{'v'}{version}</Text>
      </Text>

      {/* Top separator */}
      <Text>{SEP}</Text>

      {/* Background art rows */}
      {ART_ROWS_PLAIN.map((row, i) => (
        <Text key={i}>{row}</Text>
      ))}

      {/* Mascot rows (brand color) */}
      <Text color={theme.colors.brand}>{MASCOT_ROW_0}</Text>
      <Text color={theme.colors.brand}>{MASCOT_ROW_1}</Text>
      <Text color={theme.colors.brand}>{MASCOT_ROW_2}</Text>

      {/* Bottom separator */}
      <Text>{SEP}</Text>

      {/* Bottom row: mascot feet embedded in ellipsis */}
      <Text color={theme.colors.brand}>{BOT_SEP}</Text>
    </Box>
  );
}
