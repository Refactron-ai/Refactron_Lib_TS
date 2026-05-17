import { describe, it, expect } from 'vitest';
import {
  insertDocstring,
  appendChangelog,
  normalizeDocstringContent,
} from '../../../src/document/apply.js';

describe('normalizeDocstringContent', () => {
  it('collapses six-quote wrapping — the original bug', () => {
    expect(normalizeDocstringContent('python', '""""""Represents a user.""""""')).toBe(
      'Represents a user.',
    );
  });

  it('strips a single triple-quote wrapper', () => {
    expect(normalizeDocstringContent('python', '"""Hello."""')).toBe('Hello.');
  });

  it("strips ''' wrapping", () => {
    expect(normalizeDocstringContent('python', "'''Hello.'''")).toBe('Hello.');
  });

  it('strips /** */ for typescript', () => {
    expect(normalizeDocstringContent('typescript', '/** Hello. */')).toBe('Hello.');
  });

  it('strips a code fence', () => {
    expect(normalizeDocstringContent('python', '```\nHello.\n```')).toBe('Hello.');
  });

  it('leaves bare content untouched', () => {
    expect(normalizeDocstringContent('python', 'Hello.')).toBe('Hello.');
  });
});

describe('insertDocstring — double-wrap regression', () => {
  it('a triple-quote-wrapped LLM answer yields exactly one wrapper', () => {
    const out = insertDocstring('python', 'def f(x):\n    return x\n', 'f', '"""Add."""');
    expect(out).toBe('def f(x):\n    """Add."""\n    return x\n');
    expect(out).not.toContain('""""""');
  });
});

describe('insertDocstring — python', () => {
  it('inserts a single-line docstring as first body statement', () => {
    const src = `def f(x):\n    return x + 1\n`;
    const out = insertDocstring('python', src, 'f', 'Add one.');
    expect(out).toBe(`def f(x):\n    """Add one."""\n    return x + 1\n`);
  });

  it('inserts a multi-line docstring with body indent applied to each line', () => {
    const src = `def f(x):\n    return x + 1\n`;
    const out = insertDocstring('python', src, 'f', 'Line one.\nLine two.');
    expect(out).toBe(`def f(x):\n    """Line one.\n    Line two."""\n    return x + 1\n`);
  });

  it('returns source unchanged when the symbol cannot be located', () => {
    const src = `def f(x):\n    return x\n`;
    expect(insertDocstring('python', src, 'missing', 'doc')).toBe(src);
  });
});

describe('insertDocstring — typescript', () => {
  it('inserts a /** ... */ block above a function declaration', () => {
    const src = `export function add(a: number, b: number): number {\n  return a + b;\n}\n`;
    const out = insertDocstring('typescript', src, 'add', 'Adds two numbers.');
    expect(out).toBe(
      `/** Adds two numbers. */\nexport function add(a: number, b: number): number {\n  return a + b;\n}\n`,
    );
  });

  it('preserves the leading indentation of the declaration line', () => {
    const src = `  function inner() {\n    return 1;\n  }\n`;
    const out = insertDocstring('typescript', src, 'inner', 'Inner.');
    expect(out).toBe(`  /** Inner. */\n  function inner() {\n    return 1;\n  }\n`);
  });

  it('returns source unchanged when the symbol cannot be located', () => {
    const src = `function other() {}\n`;
    expect(insertDocstring('typescript', src, 'missing', 'doc')).toBe(src);
  });
});

describe('appendChangelog', () => {
  it('creates a Changelog scaffold when the existing content is empty', () => {
    const out = appendChangelog(
      '',
      ['- Migrated requests → httpx.', '- Inlined f-strings.'],
      '2025-01-15',
    );
    expect(out).toBe(
      `# Changelog\n\n## [Unreleased] — 2025-01-15\n\n- Migrated requests → httpx.\n- Inlined f-strings.\n`,
    );
  });

  it('inserts an Unreleased section above the previous entry under # Changelog', () => {
    const existing = `# Changelog\n\n## [0.1.0] — 2024-12-01\n\n- initial release\n`;
    const out = appendChangelog(existing, ['- Migrated requests → httpx.'], '2025-01-15');
    expect(out).toBe(
      `# Changelog\n\n## [Unreleased] — 2025-01-15\n\n- Migrated requests → httpx.\n\n## [0.1.0] — 2024-12-01\n\n- initial release\n`,
    );
  });
});
