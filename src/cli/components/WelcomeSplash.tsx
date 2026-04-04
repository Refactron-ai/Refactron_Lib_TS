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

// Bottom separator (plain ellipsis — mascot is now rendered separately in LoginFlow)
const BOT_SEP = '\u2026'.repeat(WELCOME_WIDTH);

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

      {/* Bottom separators */}
      <Text>{SEP}</Text>
      <Text>{BOT_SEP}</Text>
    </Box>
  );
}
