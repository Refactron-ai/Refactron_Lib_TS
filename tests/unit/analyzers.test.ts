// tests/unit/analyzers.test.ts
import { describe, it, expect } from 'vitest';
import { SecurityAnalyzer } from '../../src/analysis/analyzers/security.js';
import { DependenciesAnalyzer } from '../../src/analysis/analyzers/dependencies.js';
import { ComplexityAnalyzer } from '../../src/analysis/analyzers/complexity.js';

const cfg = { enabled: true, threshold: 5 };

describe('SecurityAnalyzer', () => {
  it('detects SQL injection', async () => {
    const a = new SecurityAnalyzer();
    const result = await a.analyze('views.py', `cursor.execute(f"SELECT * WHERE id={user_id}")`, cfg);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.type).toBe('sql-injection');
    expect(result.issues[0]?.severity).toBe('critical');
  });

  it('detects eval()', async () => {
    const a = new SecurityAnalyzer();
    const result = await a.analyze('app.ts', `const x = eval(input)`, cfg);
    expect(result.issues.some((i) => i.type === 'dangerous-eval')).toBe(true);
  });
});

describe('DependenciesAnalyzer', () => {
  it('detects unused Python import', async () => {
    const a = new DependenciesAnalyzer();
    const code = `import os\nimport json\n\ndef load():\n    return json.load(open('f'))`;
    const result = await a.analyze('app.py', code, cfg);
    expect(result.issues.some((i) => i.message.includes("'os'"))).toBe(true);
  });
});

describe('ComplexityAnalyzer', () => {
  it('detects high complexity function', async () => {
    const a = new ComplexityAnalyzer();
    const code = `def foo():\n  if a:\n    if b:\n      if c:\n        if d:\n          if e:\n            return 1`;
    const result = await a.analyze('app.py', code, cfg);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues[0]?.type).toBe('high-complexity');
  });
});
