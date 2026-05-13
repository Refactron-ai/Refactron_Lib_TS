// tests/unit/cli/config-loader.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadRefactronConfig } from '../../../src/cli/config-loader.js';

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'refactron-rc-'));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('loadRefactronConfig', () => {
  it('returns defaults when no config file is present', async () => {
    const cfg = await loadRefactronConfig(tmp);
    expect(cfg.transforms).toEqual(['all']);
    expect(cfg.exclude).toEqual([]);
    expect(cfg.testCmd).toBeNull();
    expect(cfg.confidence).toBe('high');
    expect(cfg.dryRun).toBe(true);
  });

  it('reads values from .refactronrc.json', async () => {
    const payload = {
      transforms: ['var_to_const_let', 'implicit_any'],
      exclude: ['build/', 'coverage/'],
      testCmd: 'npm test',
      confidence: 'medium',
      dryRun: false,
    };
    await fs.writeFile(path.join(tmp, '.refactronrc.json'), JSON.stringify(payload, null, 2));
    const cfg = await loadRefactronConfig(tmp);
    expect(cfg.transforms).toEqual(['var_to_const_let', 'implicit_any']);
    expect(cfg.exclude).toEqual(['build/', 'coverage/']);
    expect(cfg.testCmd).toBe('npm test');
    expect(cfg.confidence).toBe('medium');
    expect(cfg.dryRun).toBe(false);
  });

  it('throws on invalid schema (wrong type / unknown key)', async () => {
    const bad = { confidence: 'extremely-high', somethingElse: 42 };
    await fs.writeFile(path.join(tmp, '.refactronrc.json'), JSON.stringify(bad));
    await expect(loadRefactronConfig(tmp)).rejects.toThrow(/Invalid \.refactronrc/);
  });

  it('rejects unknown transform ids', async () => {
    const bad = { transforms: ['not_a_real_transform'] };
    await fs.writeFile(path.join(tmp, '.refactronrc.json'), JSON.stringify(bad));
    await expect(loadRefactronConfig(tmp)).rejects.toThrow(/Invalid \.refactronrc/);
  });
});
