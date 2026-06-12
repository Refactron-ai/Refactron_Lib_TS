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

  // Regression: Ansible's `_ssh_agent.py` has a static method whose return
  // type subscript spans 8 lines (`def get_dataclass(...) -> type[\n    t.Union[\n …]:`).
  // The pre-fix inserter latched onto the first inner line (`        t.Union[`)
  // as the body and produced syntactically invalid Python — the post-apply
  // syntax recheck caught and rolled the file back, but only after the bad
  // write. Inserter must walk the full bracket-balanced signature, then place
  // the docstring above the first true body line.
  it('walks a multi-line bracketed return-type signature before placing the docstring', () => {
    const src = [
      'class C:',
      '    @staticmethod',
      '    def get_dataclass(t: KeyAlgo) -> type[',
      '        Union[',
      '            A,',
      '            B,',
      '        ]',
      '    ]:',
      '        match t:',
      '            case _: return A',
      '',
    ].join('\n');
    const out = insertDocstring('python', src, 'get_dataclass', 'Documents get_dataclass.');
    // Docstring lands inside the function body, NOT inside the type subscript.
    const idx = out.indexOf('"""');
    const sigEnd = out.indexOf('    ]:');
    const bodyStart = out.indexOf('        match t:');
    expect(idx).toBeGreaterThan(sigEnd);
    expect(idx).toBeLessThan(bodyStart);
    // And syntactically valid: nothing inserted inside the `type[…]` subscript.
    expect(out).not.toMatch(/type\[\n\s*"""/);
    expect(out).not.toMatch(/Union\[\n\s*"""/);
  });

  // Protocol stubs (`def f(...) -> T: ...`) have the body inline with the
  // signature — there's no separate body line to insert above. The inserter
  // must bail rather than walk forward and latch onto the NEXT def with this
  // name (which would stack a docstring inside an unrelated sibling).
  it('bails on single-line `def …: ...` stubs (Protocol) without latching onto a sibling', () => {
    const src = [
      'class Stub(t.Protocol):',
      '    def encode(self) -> bytes: ...',
      '',
      'class Real:',
      '    def encode(self) -> bytes:',
      '        return b""',
      '',
    ].join('\n');
    const out = insertDocstring('python', src, 'encode', 'Documents encode.');
    // Source returned unchanged — the Protocol stub is the first match and
    // it's inline; the real `Real.encode` below MUST NOT inherit the docstring
    // intended for the Protocol method.
    expect(out).toBe(src);
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
