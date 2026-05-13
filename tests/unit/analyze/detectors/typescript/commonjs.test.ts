import { describe, it, expect } from 'vitest';
import { parseTypescript } from '../../../../../src/analyze/parser.js';
import { detect } from '../../../../../src/analyze/detectors/typescript/commonjs.js';

const ctx = (s: string) => ({
  absPath: '/x/a.ts',
  relPath: 'a.ts',
  source: s,
  tree: parseTypescript(s, false),
});

describe('ts: commonjs', () => {
  it('flags require()', () => {
    expect(detect(ctx('const x = require("path");\n'))).toHaveLength(1);
  });
  it('flags module.exports', () => {
    expect(detect(ctx('module.exports = { x: 1 };\n'))).toHaveLength(1);
  });
  it('flags exports.X = ...', () => {
    expect(detect(ctx('exports.x = 1;\n'))).toHaveLength(1);
  });
});
