// tests/unit/config.test.ts
import { describe, it, expect } from 'vitest';
import { loadConfig, defaultConfig } from '../../src/core/config.js';

describe('loadConfig', () => {
  it('returns default config when no refactron.yaml found', async () => {
    const config = await loadConfig('/nonexistent/path/that/does/not/exist');
    expect(config.analyzers.complexity.enabled).toBe(true);
    expect(config.analyzers.complexity.threshold).toBe(10);
    expect(config.verification.timeout_seconds).toBe(45);
  });

  it('defaultConfig has all required analyzer keys', () => {
    const keys = Object.keys(defaultConfig.analyzers);
    expect(keys).toContain('complexity');
    expect(keys).toContain('security');
    expect(keys).toContain('code_smell');
    expect(keys).toContain('dead_code');
    expect(keys).toContain('type_hints');
    expect(keys).toContain('dependencies');
    expect(keys).toContain('performance');
  });
});
