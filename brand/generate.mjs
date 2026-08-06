#!/usr/bin/env node
// Regenerates every Tabslot asset from tabslot-sprites.json.
//
// Nothing in brand/ except the JSON is written by hand. Run this after any edit
// to the sprite maps:  node brand/generate.mjs
//
// It validates before it writes. A sprite that fails a check throws rather than
// producing a crooked asset, because a mascot that quietly loses its socket in
// one state is worse than a build error.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { encodePng, paint } from './png.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(readFileSync(join(HERE, 'tabslot-sprites.json'), 'utf8'));

const [ROWS, COLS] = spec.grid;
const DOT = spec.transparent;
const CODES = Object.keys(spec.palette);
const STATE_KEYS = Object.keys(spec.states);

const fail = (msg) => {
  throw new Error(`tabslot-sprites.json: ${msg}`);
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const rowsOf = (key) => spec.states[key].map;
const region = (key, [from, to]) => rowsOf(key).slice(from, to + 1);
const widestRow = (rows, code) => {
  // The most contiguous horizontal runs of `code` found in any single row.
  // Counted per row, not summed: a total would read 1+1 and 2+0 as the same
  // number and would pass a one-piece tab and a snapped one interchangeably.
  let most = 0;
  for (const row of rows) {
    let n = 0;
    let inRun = false;
    for (const ch of row) {
      if (ch === code && !inRun) n++;
      inRun = ch === code;
    }
    most = Math.max(most, n);
  }
  return most;
};

// 1. Shape and alphabet.
for (const key of STATE_KEYS) {
  const map = rowsOf(key);
  if (map.length !== ROWS) fail(`state "${key}" has ${map.length} rows, expected ${ROWS}`);
  map.forEach((row, y) => {
    if (row.length !== COLS)
      fail(`state "${key}" row ${y} is ${row.length} wide, expected ${COLS}`);
    for (const ch of row) {
      if (ch !== DOT && !CODES.includes(ch))
        fail(`state "${key}" row ${y} uses unknown code "${ch}"`);
    }
  });
}

// 2. Every declared flat hex really is the ink composited over the ground at the
//    palette alpha. The terminal cannot do alpha, so it consumes these values
//    directly; if they drift from the SVGs the two surfaces stop matching.
const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
const toHex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0').toUpperCase()).join('');
for (const [name, g] of Object.entries(spec.grounds)) {
  const bg = hex(g.bg);
  const fg = hex(g.ink);
  for (const code of CODES) {
    const a = spec.palette[code].alpha;
    const want = toHex(fg.map((v, i) => Math.round(a * v + (1 - a) * bg[i])));
    if (g.flat[code].toUpperCase() !== want) {
      fail(
        `ground "${name}" flat.${code} is ${g.flat[code]}, but ${g.ink} at ${a} over ${g.bg} is ${want}`,
      );
    }
  }
}

// 3. The socket never reacts to the verdict. Byte-identical in all three states
//    is the strongest form of that rule, and the cheapest to check.
const socketOf = (key) => region(key, spec.regions.socket).join('\n');
for (const key of STATE_KEYS.slice(1)) {
  if (socketOf(key) !== socketOf(STATE_KEYS[0])) {
    fail(`state "${key}" changes the socket. The socket is the same in every state.`);
  }
}

// 4. Seating. safe and unsafe are seated (socket ink reaches up into the body);
//    unproven never gets there, which is the whole reading of that state.
const seated = (key) => region(key, spec.regions.body).some((row) => row.includes('G'));
if (!seated('safe')) fail('state "safe" is not seated: no socket ink inside the body');
if (!seated('unsafe')) fail('state "unsafe" is not seated: UNSAFE is damage, not collapse');
if (seated('unproven')) fail('state "unproven" is seated: UNPROVEN never reaches the socket');

// 5. The crown. Shape first, then which states share it, so a broken tab is
//    reported as a broken tab rather than as a mismatch with its neighbour.
const crown = (key) => widestRow(region(key, spec.regions.crown), 'B');
if (crown('safe') !== 1)
  fail(`the safe crown is in ${crown('safe')} pieces, expected one whole tab`);
if (crown('unproven') !== 1)
  fail('the unproven crown must be whole: UNPROVEN is blank, not broken');
if (crown('unsafe') !== 2)
  fail(`the unsafe crown is in ${crown('unsafe')} pieces, expected exactly two`);

const crownOf = (key) => region(key, spec.regions.crown).join('\n');
if (crownOf('unproven') !== crownOf('safe')) fail('state "unproven" must keep the safe crown');
if (crownOf('unsafe') === crownOf('safe')) fail('state "unsafe" must break the crown');

// 6. The break flies apart. The gap the fragments leave behind must be at least
//    as wide as the tab that used to fill it, and they must stand shorter than
//    it did, or the damage reads as a smaller tab rather than a snapped one.
//
//    Checking that the fragments merely spread wider than the tab would be
//    vacuous: two pieces always need a gap, so they always span at least three
//    columns. The gap is the measurement that can actually come out too small.
const inked = (row) => [...row].reduce((a, ch, x) => (ch === DOT ? a : [...a, x]), []);
const inkedRows = (rows) => rows.filter((row) => inked(row).length > 0).length;
const widestGap = (rows) => {
  let most = 0;
  for (const row of rows) {
    const xs = inked(row);
    if (xs.length < 2) continue;
    let run = 0;
    for (let x = xs[0]; x <= xs[xs.length - 1]; x++) {
      run = row[x] === DOT ? run + 1 : 0;
      most = Math.max(most, run);
    }
  }
  return most;
};
const wholeCrown = region('safe', spec.regions.crown);
const brokeCrown = region('unsafe', spec.regions.crown);
const tabWidth = Math.max(...wholeCrown.map((row) => inked(row).length));
if (widestGap(brokeCrown) < tabWidth) {
  fail(
    `the unsafe fragments leave a ${widestGap(brokeCrown)} column gap where a ${tabWidth} column tab was`,
  );
}
if (inkedRows(brokeCrown) >= inkedRows(wholeCrown)) {
  fail(
    `the unsafe fragments occupy ${inkedRows(brokeCrown)} rows, not fewer than the whole tab's ${inkedRows(wholeCrown)}`,
  );
}

// 7. The socket outline is the body's shoulder mirrored, which is what makes the
//    two bands read as parts that fit rather than as a block on a slab.
const [bodyTop] = spec.regions.body;
const [socketTop, socketBottom] = spec.regions.socket;
const outline = (y) => inked(rowsOf('safe')[y]).join(',');
for (let i = 0; i <= socketBottom - socketTop - 1; i++) {
  const s = socketBottom - i;
  const b = bodyTop + i;
  if (outline(s) !== outline(b)) {
    fail(`socket row ${s} does not mirror body row ${b}: [${outline(s)}] vs [${outline(b)}]`);
  }
}

// ---------------------------------------------------------------------------
// SVG
// ---------------------------------------------------------------------------

const FILES = {
  safe: 'tabslot',
  unsafe: 'tabslot-sheared',
  unproven: 'tabslot-unprinted',
};

function svg(key, groundName) {
  const g = spec.grounds[groundName];
  const map = rowsOf(key);
  const rects = [];
  map.forEach((row, y) => {
    let x = 0;
    while (x < COLS) {
      const code = row[x];
      if (code === DOT) {
        x++;
        continue;
      }
      let w = 1;
      while (x + w < COLS && row[x + w] === code) w++;
      const alpha = spec.palette[code].alpha;
      const op = alpha === 1 ? '' : ` opacity="${alpha}"`;
      rects.push(`  <rect x="${x}" y="${y}" width="${w}" height="1" fill="${g.ink}"${op}/>`);
      x += w;
    }
  });
  const label = `Tabslot, ${spec.states[key].form}, the Refactron ${key.toUpperCase()} mark`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${COLS} ${ROWS}" width="${COLS * 32}" height="${ROWS * 32}" shape-rendering="crispEdges" role="img" aria-label="${label}">`,
    ...rects,
    '</svg>',
    '',
  ].join('\n');
}

// Every file is named for the colour of its own ink, never for the ground it is
// meant to sit on. docs/logo uses the other convention, where "-light" names the
// light coloured asset that goes on the DARK ground, and that reads backwards
// often enough to be worth breaking with here: once rasters exist there are both
// transparent marks and opaque avatars in one directory, and a name that means
// the ground on half the files and the ink on the other half is unusable.
//
// So: the ground key "ink" produces the asset inked in cream, and vice versa.
const TONE = { ink: 'cream', cream: 'ink' };

const written = [];
for (const key of STATE_KEYS) {
  for (const groundName of Object.keys(spec.grounds)) {
    const name = `${FILES[key]}-${TONE[groundName]}.svg`;
    writeFileSync(join(HERE, name), svg(key, groundName));
    written.push(name);
  }
}

// ---------------------------------------------------------------------------
// Terminal
// ---------------------------------------------------------------------------

// Collapses two sprite rows into one text row using half blocks, and keeps the
// tone per run, because a two-colour mascot printed in one colour is not the
// mascot. When the two halves disagree the LOWER half wins, so socket ink
// emerging under the body reads as socket rather than as body.
function blockRuns(map) {
  const out = [];
  for (let y = 0; y < map.length; y += 2) {
    const top = map[y];
    const bot = map[y + 1] ?? DOT.repeat(COLS);
    const cells = [];
    for (let x = 0; x < COLS; x++) {
      const a = top[x] !== DOT;
      const c = bot[x] !== DOT;
      const ch = a && c ? '█' : a ? '▀' : c ? '▄' : ' ';
      cells.push([ch, ch === ' ' ? null : c ? bot[x] : top[x]]);
    }
    while (cells.length && cells[cells.length - 1][0] === ' ') cells.pop();
    const runs = [];
    for (const [ch, tone] of cells) {
      const last = runs[runs.length - 1];
      if (last && last.tone === tone) last.text += ch;
      else runs.push({ tone, text: ch });
    }
    out.push(runs);
  }
  while (out.length && out[out.length - 1].length === 0) out.pop();
  return out;
}

const terminal = {};
for (const key of STATE_KEYS) terminal[key] = blockRuns(rowsOf(key));

writeFileSync(
  join(HERE, 'tabslot-terminal.json'),
  JSON.stringify(
    {
      note: 'Generated by brand/generate.mjs. Do not edit. Each state is an array of text rows; each row is an array of {tone, text} runs, and tone indexes tabslot-sprites.json palette.',
      rows: blockRuns(rowsOf('safe')).length,
      cols: COLS,
      states: terminal,
    },
    null,
    2,
  ) + '\n',
);
written.push('tabslot-terminal.json');

// The plain art is lossy on purpose: it is what a README or a pipe without
// colour gets. The CLI must render the runs above, not this.
const plain = STATE_KEYS.map((key) => {
  const head = `${key.toUpperCase()}  (${spec.states[key].form})`;
  const art = terminal[key].map((runs) => '  ' + runs.map((r) => r.text).join(''));
  return [head, '', ...art].join('\n');
}).join('\n\n');
writeFileSync(join(HERE, 'tabslot.txt'), plain + '\n');
written.push('tabslot.txt');

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

// Painted from the grid, never rasterised from the SVG, and only ever at a whole
// number scale. The largest whole multiple of 14 that leaves the wanted margin
// is used, so the actual coverage lands near the target rather than on it. Marks
// sit at roughly 85 percent of the canvas; avatars at roughly 71, because every
// platform crops an avatar to a circle or a rounded square.
const MARK_MARGIN = 0.07;
const AVATAR_MARGIN = 0.14;

const rgbOf = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));

const inkFor = (groundName) =>
  Object.fromEntries(
    CODES.map((code) => [
      code,
      { rgb: rgbOf(spec.grounds[groundName].ink), alpha: spec.palette[code].alpha },
    ]),
  );

function fit(canvas, marginPct) {
  const margin = Math.max(2, Math.round(canvas * marginPct));
  const scale = Math.floor((canvas - 2 * margin) / COLS);
  if (scale < 1) throw new Error(`fit: a ${canvas}px canvas cannot hold a ${COLS} cell sprite`);
  return scale;
}

function png(name, { key, groundName, canvas, marginPct, opaque }) {
  const scale = fit(canvas, marginPct);
  const { px, artW } = paint({
    map: rowsOf(key),
    transparent: DOT,
    ink: inkFor(groundName),
    canvas,
    scale,
    ground: opaque ? rgbOf(spec.grounds[groundName].bg) : null,
  });
  writeFileSync(join(HERE, name), encodePng(canvas, canvas, px));
  written.push(`${name}  (${scale}x, art ${artW}px, ${Math.round((artW / canvas) * 100)}%)`);
}

// Transparent marks. SAFE carries the full ladder down to favicon sizes; the two
// failure states stop at 256, because nothing should be making a favicon out of
// UNSAFE.
const MARK_SIZES = {
  safe: [1024, 512, 256, 64, 32],
  unsafe: [1024, 512, 256],
  unproven: [1024, 512, 256],
};

for (const key of STATE_KEYS) {
  for (const groundName of Object.keys(spec.grounds)) {
    for (const canvas of MARK_SIZES[key]) {
      png(`${FILES[key]}-${TONE[groundName]}-${canvas}.png`, {
        key,
        groundName,
        canvas,
        marginPct: MARK_MARGIN,
        opaque: false,
      });
    }
  }
}

// Opaque avatars, SAFE only: an avatar is the mascot, not a verdict. 400 is the
// minimum X and LinkedIn accept.
for (const [groundName, sizes] of Object.entries({ ink: [1024, 512, 400], cream: [1024, 512] })) {
  for (const canvas of sizes) {
    png(`tabslot-${TONE[groundName]}-on-${groundName}-${canvas}.png`, {
      key: 'safe',
      groundName,
      canvas,
      marginPct: AVATAR_MARGIN,
      opaque: true,
    });
  }
}

console.log(`ok  ${STATE_KEYS.length} states validated, ${written.length} files written`);
for (const name of written) console.log(`    ${name}`);
