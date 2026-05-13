// tests/unit/cli/runner-parse.test.ts
// Regression tests for the REPL command parser. Locks in the boolean-flag
// whitelist so `run --apply <path>` does NOT eat the path as the value of
// --apply (the original bug: flags.apply became '<path>', target stayed '.',
// and the apply branch was bypassed because flags.apply !== true).
import { describe, it, expect } from 'vitest';
import { parseInput } from '../../../src/cli/runner.js';

describe('parseInput — boolean flags', () => {
  it('treats --apply as boolean even when followed by a positional path', () => {
    const r = parseInput('run --apply fixtures/python-legacy-mini/callbacks.py');
    expect(r.command).toBe('run');
    expect(r.flags['apply']).toBe(true);
    expect(r.target).toBe('fixtures/python-legacy-mini/callbacks.py');
  });

  it('treats --dry-run, --json, --no-cache, --quiet as boolean', () => {
    expect(parseInput('run --dry-run path').flags['dry-run']).toBe(true);
    expect(parseInput('run --json').flags['json']).toBe(true);
    expect(parseInput('document --no-cache').flags['no-cache']).toBe(true);
    expect(parseInput('analyze --quiet src').flags['quiet']).toBe(true);
  });

  it('--apply with no positional still parses as boolean', () => {
    const r = parseInput('run --apply');
    expect(r.flags['apply']).toBe(true);
    expect(r.target).toBe('.');
  });
});

describe('parseInput — value flags', () => {
  it('consumes the next token as the value for unknown (non-boolean) flags', () => {
    const r = parseInput('run --transforms format_to_fstring');
    expect(r.flags['transforms']).toBe('format_to_fstring');
    expect(r.target).toBe('.');
  });

  it('supports --flag=value form', () => {
    const r = parseInput('run --transforms=all --apply fixtures/x');
    expect(r.flags['transforms']).toBe('all');
    expect(r.flags['apply']).toBe(true);
    expect(r.target).toBe('fixtures/x');
  });

  it('combines boolean and value flags + positional in any order', () => {
    const r = parseInput('run --apply --transforms format_to_fstring path/to/file.py');
    expect(r.flags['apply']).toBe(true);
    expect(r.flags['transforms']).toBe('format_to_fstring');
    expect(r.target).toBe('path/to/file.py');
  });
});

describe('parseInput — command + leading slash', () => {
  it('strips the leading slash from /analyze, /run, etc.', () => {
    expect(parseInput('/analyze src').command).toBe('analyze');
    expect(parseInput('/run --apply').command).toBe('run');
  });

  it('defaults target to .', () => {
    expect(parseInput('analyze').target).toBe('.');
  });
});
