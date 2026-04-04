// tests/unit/python-adapter.test.ts
import { describe, it, expect } from 'vitest';
import { PythonAdapter } from '../../src/adapters/python/index.js';

describe('PythonAdapter', () => {
  it('has correct identity properties', () => {
    const adapter = new PythonAdapter();
    expect(adapter.name).toBe('python');
    expect(adapter.extensions).toContain('.py');
    expect(adapter.displayName).toBe('Python');
  });

  it('verifySyntax passes for valid Python code', async () => {
    const adapter = new PythonAdapter();
    const result = await adapter.verifySyntax('test.py', 'def foo():\n    return 1\n');
    expect(result.passed).toBe(true);
  });

  it('verifySyntax fails for invalid Python code', async () => {
    const adapter = new PythonAdapter();
    const result = await adapter.verifySyntax(
      'test.py',
      'def foo(\n    # missing closing paren and body',
    );
    expect(result.passed).toBe(false);
    expect(result.blockingReason).toBeTruthy();
  });

  it('generateDiff returns a diff string', () => {
    const adapter = new PythonAdapter();
    const diff = adapter.generateDiff('import os\nfoo()', 'foo()');
    expect(diff).toContain('-');
    expect(diff).toContain('import os');
  });
});
