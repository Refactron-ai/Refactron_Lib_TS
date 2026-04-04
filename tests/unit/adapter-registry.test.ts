// tests/unit/adapter-registry.test.ts
import { describe, it, expect } from 'vitest';
import { AdapterRegistry } from '../../src/adapters/registry.js';

describe('AdapterRegistry', () => {
  it('returns Python adapter for .py files', () => {
    const registry = new AdapterRegistry();
    const adapter = registry.adapterForFile('app.py');
    expect(adapter?.name).toBe('python');
  });

  it('returns TypeScript adapter for .ts files', () => {
    const registry = new AdapterRegistry();
    const adapter = registry.adapterForFile('app.ts');
    expect(adapter?.name).toBe('typescript');
  });

  it('returns TypeScript adapter for .tsx files', () => {
    const registry = new AdapterRegistry();
    const adapter = registry.adapterForFile('Component.tsx');
    expect(adapter?.name).toBe('typescript');
  });

  it('returns null for unknown extension', () => {
    const registry = new AdapterRegistry();
    expect(registry.adapterForFile('script.rb')).toBeNull();
  });

  it('getAll returns both adapters', () => {
    const registry = new AdapterRegistry();
    const all = registry.getAll();
    expect(all.map((a) => a.name)).toContain('python');
    expect(all.map((a) => a.name)).toContain('typescript');
  });
});
