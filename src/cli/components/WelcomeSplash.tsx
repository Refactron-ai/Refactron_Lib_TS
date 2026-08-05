// src/cli/components/WelcomeSplash.tsx
// YRC WelcomeV2-equivalent: open borderless layout, fixed 58-char width.
// Shown in LoginFlow (before auth). No box borders — exactly like Claude Code's startup screen.
import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../../ui/theme.js';
import { getMascotRows, MascotLine } from './Mascot.js';

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

// The mascot is NOT redeclared here. This file used to carry its own copy of
// the sprite in three constants, plus a fourth embedded in the bottom rule, and
// that is how a mascot drifts away from its brand definition. It now comes from
// Mascot.tsx, which a test pins to brand/tabslot-terminal.json.

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
        <Text dimColor>
          {'v'}
          {version}
        </Text>
      </Text>

      {/* Top separator */}
      <Text>{SEP}</Text>

      {/* Background art rows */}
      {ART_ROWS_PLAIN.map((row, i) => (
        <Text key={i}>{row}</Text>
      ))}

      {/* Tabslot, indented to sit under the art above */}
      <Box flexDirection="column" marginLeft={5}>
        {getMascotRows().map((row, i) => (
          <MascotLine key={i} row={row} />
        ))}
      </Box>

      {/* Bottom separator */}
      <Text>{SEP}</Text>
    </Box>
  );
}
