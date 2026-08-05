// src/cli/components/Mascot.tsx
// Tabslot, the Refactron mascot: a 14x14 sprite collapsed to 7 terminal rows
// with half blocks, printed in one colour at two values.
//
// IMPORTANT: foreground color only — no backgroundColor.
// backgroundColor on Text+block chars causes terminal render glitches.
//
// The sprite below is GENERATED from brand/tabslot-terminal.json, which is
// itself generated from brand/tabslot-sprites.json by brand/generate.mjs. Do
// not hand edit it: the generator validates the geometry (the socket is
// identical in every state, UNSAFE breaks the crown and UNPROVEN does not, and
// so on) and an edit made here skips every one of those checks.
// `tests/unit/cli/mascot-drift.test.ts` pins this copy to the brand file.
//
// Two tones matter. A mascot drawn in one colour is not this mascot: the socket
// is the brand cream at 42 percent, which is the same two-value system the
// Refactron mark uses. That is why a row is a list of runs rather than a
// string — each run needs its own <Text>.
import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../../ui/theme.js';

/**
 * The three verdict states, named as `verdict-fuse.ts` names them.
 *
 * `safe` is also the identity mark: whole and undamaged, which is what the
 * session header and the splash use. It is not making a claim there.
 *
 * The brand rule for the other two is that they never appear without the
 * verdict word beside them, spelled out. A shape is not a report.
 */
export type MascotState = 'safe' | 'unsafe' | 'unproven';

/** `null` is padding, and must stay uncoloured so it cannot print as a block. */
export type MascotTone = 'body' | 'socket';

export interface MascotRun {
  readonly text: string;
  readonly tone: MascotTone | null;
}

export type MascotRow = readonly MascotRun[];

// prettier-ignore
const SPRITE: Record<MascotState, readonly MascotRow[]> = {
  safe: [
    [{ text: '      ', tone: null }, { text: '▄▄', tone: 'body' }],
    [{ text: '  ', tone: null }, { text: '▄▄▄▄██▄▄▄▄', tone: 'body' }],
    [{ text: ' ', tone: null }, { text: '██▀██████▀██', tone: 'body' }],
    [{ text: ' ', tone: null }, { text: '██▄██', tone: 'body' }, { text: '██', tone: 'socket' }, { text: '██▄██', tone: 'body' }],
    [{ text: ' ', tone: null }, { text: '▀████', tone: 'body' }, { text: '██', tone: 'socket' }, { text: '████▀', tone: 'body' }],
    [{ text: ' ', tone: null }, { text: '████████████', tone: 'socket' }],
    [{ text: '  ', tone: null }, { text: '▀▀▀▀▀▀▀▀▀▀', tone: 'socket' }],
  ],
  unsafe: [
    [{ text: '     ', tone: null }, { text: '▄', tone: 'body' }, { text: '  ', tone: null }, { text: '▄', tone: 'body' }],
    [{ text: '  ', tone: null }, { text: '▄▄▄▄▄▄▄▄▄▄', tone: 'body' }],
    [{ text: ' ', tone: null }, { text: '██▀██████▀██', tone: 'body' }],
    [{ text: ' ', tone: null }, { text: '██▄██', tone: 'body' }, { text: '██', tone: 'socket' }, { text: '██▄██', tone: 'body' }],
    [{ text: ' ', tone: null }, { text: '▀████', tone: 'body' }, { text: '██', tone: 'socket' }, { text: '████▀', tone: 'body' }],
    [{ text: ' ', tone: null }, { text: '████████████', tone: 'socket' }],
    [{ text: '  ', tone: null }, { text: '▀▀▀▀▀▀▀▀▀▀', tone: 'socket' }],
  ],
  unproven: [
    [{ text: '      ', tone: null }, { text: '▄▄', tone: 'body' }],
    [{ text: '  ', tone: null }, { text: '▄▄▄▄██▄▄▄▄', tone: 'body' }],
    [{ text: ' ', tone: null }, { text: '██▀██████▀██', tone: 'body' }],
    [{ text: ' ', tone: null }, { text: '██▄██▀▀██▄██', tone: 'body' }],
    [{ text: '  ', tone: null }, { text: '▀█▀', tone: 'body' }, { text: '      ', tone: null }, { text: '▀█', tone: 'body' }],
    [{ text: ' ', tone: null }, { text: '████████████', tone: 'socket' }],
    [{ text: '  ', tone: null }, { text: '▀▀▀▀▀▀▀▀▀▀', tone: 'socket' }],
  ],
};

/** Rows in every state. The layouts beside the mascot depend on this. */
export const MASCOT_ROWS = 7;

/** Widest row in cells, so a caller can reserve a column without measuring. */
export const MASCOT_COLS = 14;

function toneColor(tone: MascotTone): string {
  return tone === 'body' ? theme.colors.mascot : theme.colors.mascotSocket;
}

/**
 * One row, emitted as a run per tone rather than as a single coloured string.
 *
 * Padding runs are rendered with no `color` prop at all rather than with an
 * undefined one: under `exactOptionalPropertyTypes` those are not the same
 * thing, and colouring the padding would print the mascot's bounding box.
 */
export function MascotLine({ row }: { row: MascotRow }): React.ReactElement {
  return (
    <Text>
      {row.map((run, i) =>
        run.tone === null ? (
          <Text key={i}>{run.text}</Text>
        ) : (
          <Text key={i} color={toneColor(run.tone)}>
            {run.text}
          </Text>
        ),
      )}
    </Text>
  );
}

interface MascotProps {
  state?: MascotState;
}

export function Mascot({ state = 'safe' }: MascotProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      {SPRITE[state].map((row, i) => (
        <MascotLine key={i} row={row} />
      ))}
    </Box>
  );
}

/** The rows for a state, for callers that lay the mascot out themselves. */
export function getMascotRows(state: MascotState = 'safe'): readonly MascotRow[] {
  return SPRITE[state];
}

/**
 * The sprite flattened to plain strings, losing the tone.
 *
 * Only for surfaces that genuinely cannot carry colour. The socket and the body
 * become the same glyph, so SAFE and UNSAFE then differ only at the crown.
 */
export function getMascotPlainRows(state: MascotState = 'safe'): readonly string[] {
  return SPRITE[state].map((row) => row.map((run) => run.text).join(''));
}
