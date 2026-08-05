// Drift detection for the mascot sprite.
//
// Tabslot's source of truth is brand/tabslot-sprites.json, validated and
// expanded by brand/generate.mjs into brand/tabslot-terminal.json. The CLI
// cannot import from brand/ (it is not compiled into dist/ and is excluded from
// the npm tarball), so Mascot.tsx carries an inlined copy of the terminal runs.
//
// An inlined copy is exactly what the previous mascot was, and it drifted:
// WelcomeSplash.tsx held a second hand-maintained transcription whose feet had
// been typed as U+2518 BOX DRAWINGS LIGHT UP AND LEFT instead of U+2598 QUADRANT
// UPPER LEFT, so the splash and the session header had quietly different
// mascots. Nothing caught it because nothing compared them.
//
// This test is that comparison. If the sprite is edited in brand/ and not
// regenerated into Mascot.tsx, or edited in Mascot.tsx and never in brand/, the
// build fails here rather than shipping two mascots again.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  getMascotRows,
  getMascotPlainRows,
  MASCOT_ROWS,
  MASCOT_COLS,
  type MascotState,
} from '../../../src/cli/components/Mascot.js';

const BRAND = fileURLToPath(new URL('../../../brand/tabslot-terminal.json', import.meta.url));

interface BrandRun {
  tone: 'B' | 'G' | null;
  text: string;
}
interface BrandFile {
  rows: number;
  cols: number;
  states: Record<string, BrandRun[][]>;
}

const brand = JSON.parse(readFileSync(BRAND, 'utf8')) as BrandFile;

// The brand file codes tones by palette letter; the component names them.
const TONE = { B: 'body', G: 'socket' } as const;

const STATES: readonly MascotState[] = ['safe', 'unsafe', 'unproven'];

describe('mascot sprite drift', () => {
  it.each(STATES)('%s matches brand/tabslot-terminal.json run for run', (state) => {
    const expected = brand.states[state]?.map((row) =>
      row.map((run) => ({ text: run.text, tone: run.tone === null ? null : TONE[run.tone] })),
    );
    expect(expected, `brand file has no state "${state}"`).toBeDefined();
    expect(getMascotRows(state).map((row) => row.map((run) => ({ ...run })))).toEqual(expected);
  });

  it('the declared dimensions are the brand file dimensions', () => {
    expect(MASCOT_ROWS).toBe(brand.rows);
    expect(MASCOT_COLS).toBe(brand.cols);
  });

  it.each(STATES)('%s is exactly MASCOT_ROWS rows and fits MASCOT_COLS', (state) => {
    const plain = getMascotPlainRows(state);
    expect(plain).toHaveLength(MASCOT_ROWS);
    for (const row of plain) expect(row.length).toBeLessThanOrEqual(MASCOT_COLS);
  });

  // The socket is the one part that must never react to the verdict. The brand
  // generator enforces it on the 14x14 grid; this enforces it on what ships.
  it('the socket rows are identical in all three states', () => {
    const socketOf = (state: MascotState) => JSON.stringify(getMascotRows(state).slice(5));
    expect(socketOf('unsafe')).toBe(socketOf('safe'));
    expect(socketOf('unproven')).toBe(socketOf('safe'));
  });

  // Two tones, or it is not this mascot. A single-tone render would still look
  // plausible in a terminal, which is why this is asserted rather than assumed.
  it.each(STATES)('%s uses both tones', (state) => {
    const tones = new Set(getMascotRows(state).flatMap((row) => row.map((run) => run.tone)));
    expect(tones).toContain('body');
    expect(tones).toContain('socket');
  });

  // The bug that motivated this file: two surfaces, two transcriptions, one
  // typo. There is now one source, so there is nothing left to disagree.
  it('no block glyph outside the half-block set is present', () => {
    const ALLOWED = new Set([' ', '▀', '▄', '█']); // space, ▀, ▄, █
    for (const state of STATES) {
      for (const row of getMascotPlainRows(state)) {
        for (const ch of row) {
          expect(ALLOWED, `state ${state} contains U+${ch.codePointAt(0)?.toString(16)}`).toContain(
            ch,
          );
        }
      }
    }
  });
});
