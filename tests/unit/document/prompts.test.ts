import { describe, it, expect } from 'vitest';
import {
  docstringPrompt,
  changelogPrompt,
  inlineCommentPrompt,
  reportProsePrompt,
  DOCSTRING_TEMPLATE_VERSION,
  CHANGELOG_TEMPLATE_VERSION,
  INLINE_COMMENT_TEMPLATE_VERSION,
  REPORT_TEMPLATE_VERSION,
} from '../../../src/document/prompts.js';

describe('docstringPrompt', () => {
  it('includes the symbol, language, source, and a no-narration directive', () => {
    const p = docstringPrompt({
      symbol: 'fetch',
      kind: 'function',
      language: 'python',
      oldText: 'def fetch(url, cb):\n    cb(url)\n',
      newText: 'async def fetch(url):\n    return url\n',
    });
    expect(p).toContain('[REFACTRON:DOCSTRING]');
    expect(p).toContain('fetch');
    expect(p).toContain('async def fetch(url)');
    expect(p.toLowerCase()).toContain('google style');
    expect(p.toLowerCase()).toContain('never mention refactoring');
    // The bug's root cause is gone — no "triple-quoted" instruction.
    expect(p.toLowerCase()).not.toContain('triple-quoted');
    expect(p).toContain('CONTENT ONLY');
  });

  it('changelogPrompt names each file and asks for one bullet per file', () => {
    const p = changelogPrompt({
      entries: [
        {
          relPath: 'src/a.py',
          transformId: 'format_to_fstring',
          added: 4,
          removed: 4,
          diffExcerpt: '-x = "%s" % y\n+x = f"{y}"',
        },
        {
          relPath: 'src/b.py',
          transformId: 'class_to_dataclass',
          added: 8,
          removed: 12,
          diffExcerpt: '+@dataclass',
        },
      ],
      overflow: 0,
    });
    expect(p).toContain('[REFACTRON:CHANGELOG]');
    expect(p).toContain('src/a.py');
    expect(p).toContain('src/b.py');
    expect(p).toContain('format_to_fstring');
    expect(p).toContain('one specific bullet per file');
  });

  it('changelogPrompt surfaces an overflow note', () => {
    const p = changelogPrompt({
      entries: [
        {
          relPath: 'src/a.py',
          transformId: 'format_to_fstring',
          added: 1,
          removed: 1,
          diffExcerpt: '+x',
        },
      ],
      overflow: 5,
    });
    expect(p).toMatch(/\+5 more file/);
  });

  it('inlineCommentPrompt sends numbered source and asks for strict JSON', () => {
    const p = inlineCommentPrompt({
      relPath: 'src/a.py',
      language: 'python',
      numberedSource: '  1| def f():\n  2|     return 1\n',
    });
    expect(p).toContain('[REFACTRON:INLINE]');
    expect(p).toContain('1| def f()');
    expect(p).toContain('STRICT JSON');
    expect(p).toContain('anchorContent');
  });

  it('reportProsePrompt sends the diff and asks for strict JSON', () => {
    const p = reportProsePrompt({
      files: [
        {
          relPath: 'src/a.py',
          transformId: 'format_to_fstring',
          diffExcerpt: '-x = "%s" % y\n+x = f"{y}"',
        },
      ],
    });
    expect(p).toContain('[REFACTRON:REPORT]');
    expect(p).toContain('src/a.py');
    expect(p).toContain('STRICT JSON');
  });

  it('template versions are numeric strings', () => {
    for (const v of [
      DOCSTRING_TEMPLATE_VERSION,
      CHANGELOG_TEMPLATE_VERSION,
      INLINE_COMMENT_TEMPLATE_VERSION,
      REPORT_TEMPLATE_VERSION,
    ]) {
      expect(v).toMatch(/^\d+$/);
    }
  });
});
