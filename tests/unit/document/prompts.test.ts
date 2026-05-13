import { describe, it, expect } from 'vitest';
import {
  docstringPrompt,
  changelogPrompt,
  DOCSTRING_TEMPLATE_VERSION,
  CHANGELOG_TEMPLATE_VERSION,
} from '../../../src/document/prompts.js';

describe('docstringPrompt', () => {
  it('includes the symbol name, language, before/after text, and a no-narration directive', () => {
    const p = docstringPrompt({
      symbol: 'fetch',
      language: 'python',
      oldText: 'def fetch(url, cb):\n    cb(url)\n',
      newText: 'async def fetch(url):\n    return url\n',
    });
    expect(p).toContain('fetch');
    expect(p).toContain('async def fetch(url)');
    expect(p.toLowerCase()).toContain('google-style');
    expect(p.toLowerCase()).toContain('do not describe the refactor');
    expect(p.toLowerCase()).not.toMatch(/refactored|previously/);
  });

  it('changelogPrompt summarises the transform set + file count', () => {
    const p = changelogPrompt({
      transformIds: ['format_to_fstring', 'class_to_dataclass'],
      fileCount: 3,
      summaryStats: { added: 12, removed: 9 },
    });
    expect(p).toContain('format_to_fstring');
    expect(p).toContain('class_to_dataclass');
    expect(p).toMatch(/3 file/);
  });

  it('template versions are numeric strings', () => {
    expect(DOCSTRING_TEMPLATE_VERSION).toMatch(/^\d+$/);
    expect(CHANGELOG_TEMPLATE_VERSION).toMatch(/^\d+$/);
  });
});
