import { describe, it, expect } from 'vitest';
import { parseFlags, AnalyzeFlagError } from '../../../src/cli/analyze-command.js';

describe('analyze-command parseFlags', () => {
  it('defaults: target ".", confidence "high", no fail-on', () => {
    expect(parseFlags([])).toEqual({
      target: '.',
      json: false,
      confidence: 'high',
      graphPath: null,
      failOn: null,
    });
  });

  it('accepts target as positional', () => {
    expect(parseFlags(['src/']).target).toBe('src/');
  });

  it('parses --json', () => {
    expect(parseFlags(['--json']).json).toBe(true);
  });

  it('parses --confidence both forms', () => {
    expect(parseFlags(['--confidence', 'low']).confidence).toBe('low');
    expect(parseFlags(['--confidence=medium']).confidence).toBe('medium');
  });

  it('parses --fail-on both forms', () => {
    expect(parseFlags(['--fail-on', 'high']).failOn).toBe('high');
    expect(parseFlags(['--fail-on=low']).failOn).toBe('low');
  });

  it('parses --graph=<path>', () => {
    expect(parseFlags(['--graph=/tmp/g.json']).graphPath).toBe('/tmp/g.json');
  });

  it('handles flag-then-positional in any order', () => {
    expect(parseFlags(['src/', '--fail-on', 'high'])).toMatchObject({
      target: 'src/',
      failOn: 'high',
    });
    expect(parseFlags(['--fail-on', 'high', 'src/'])).toMatchObject({
      target: 'src/',
      failOn: 'high',
    });
    expect(parseFlags(['--json', 'src/', '--confidence=low'])).toMatchObject({
      target: 'src/',
      json: true,
      confidence: 'low',
    });
  });

  it('throws on unknown long flag', () => {
    expect(() => parseFlags(['--bogus'])).toThrow(AnalyzeFlagError);
    expect(() => parseFlags(['src/', '--bogus', 'high'])).toThrow(/unknown flag: --bogus/);
  });

  it('throws on extra positional after target', () => {
    expect(() => parseFlags(['src/', 'tests/'])).toThrow(/extra argument/);
  });

  it('throws on --fail-on with no value', () => {
    expect(() => parseFlags(['--fail-on'])).toThrow(/--fail-on requires/);
  });

  it('throws on --fail-on with bad value', () => {
    expect(() => parseFlags(['--fail-on', 'critical'])).toThrow(/--fail-on requires/);
  });

  it('throws on --confidence with bad value', () => {
    expect(() => parseFlags(['--confidence=insane'])).toThrow(/--confidence requires/);
  });
});
