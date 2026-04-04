// tests/unit/autofix-engine.test.ts
import { describe, it, expect } from 'vitest';
import { AutoFixEngine } from '../../src/autofix/engine.js';
import type { CodeIssue } from '../../src/core/models.js';

const trivialBlast = {
  affectedFiles: [],
  affectedFunctions: [],
  affectedTestFiles: [],
  score: 0,
  level: 'trivial' as const,
};

function makeIssue(overrides: Partial<CodeIssue>): CodeIssue {
  return {
    id: 'test-1',
    file: 'app.py',
    line: 1,
    severity: 'low',
    type: 'unused-import',
    message: "'os' is imported but never used",
    fixable: true,
    fixerName: 'unused-imports',
    blastRadius: trivialBlast,
    ruleId: 'DEP001',
    ...overrides,
  };
}

describe('AutoFixEngine', () => {
  it('can fix unused-import issues', () => {
    const engine = new AutoFixEngine();
    expect(engine.canFix(makeIssue({}))).toBe(true);
  });

  it('removes unused import from code', async () => {
    const engine = new AutoFixEngine();
    const code = 'import os\nimport json\n\ndef foo():\n    return json.load(open("f"))';
    const result = await engine.fix('app.py', code, makeIssue({}));
    expect(result?.transformedCode).not.toContain('import os');
    expect(result?.transformedCode).toContain('import json');
  });

  it('returns null for non-fixable issues', async () => {
    const engine = new AutoFixEngine();
    const issue = makeIssue({ type: 'sql-injection', fixable: false, fixerName: undefined });
    const result = await engine.fix('app.py', 'code', issue);
    expect(result).toBeNull();
  });

  it('trailing whitespace fixer removes whitespace', async () => {
    const engine = new AutoFixEngine();
    const issue = makeIssue({ type: 'trailing-whitespace', fixerName: 'trailing-whitespace' });
    const result = await engine.fix('app.py', 'hello   \nworld  ', issue);
    expect(result?.transformedCode).toBe('hello\nworld');
  });
});
