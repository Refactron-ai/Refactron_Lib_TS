import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { detectRunner } from '../../../src/verify/runners/detect.js';

describe('detectRunner', () => {
  it('detects pytest from pyproject.toml', async () => {
    const r = await fs.mkdtemp(path.join(os.tmpdir(), 'd-'));
    await fs.writeFile(path.join(r, 'pyproject.toml'), '[tool.pytest.ini_options]\n');
    const spec = await detectRunner(r);
    expect(spec?.cmd).toBe('python3');
    expect(spec?.args).toContain('-m');
    expect(spec?.args).toContain('pytest');
  });
  it('detects vitest from vitest.config.ts', async () => {
    const r = await fs.mkdtemp(path.join(os.tmpdir(), 'd2-'));
    await fs.writeFile(path.join(r, 'package.json'), '{"name":"x"}');
    await fs.writeFile(path.join(r, 'vitest.config.ts'), 'export default {};\n');
    const spec = await detectRunner(r);
    expect(spec?.cmd).toBe('npx');
    expect(spec?.args).toContain('vitest');
  });
  it('returns null when nothing detected', async () => {
    const r = await fs.mkdtemp(path.join(os.tmpdir(), 'd3-'));
    expect(await detectRunner(r)).toBeNull();
  });
  it('explicit override wins over detection', async () => {
    const r = await fs.mkdtemp(path.join(os.tmpdir(), 'd4-'));
    await fs.writeFile(path.join(r, 'pyproject.toml'), '');
    const spec = await detectRunner(r, { override: 'make test' });
    expect(spec?.cmd).toBe('sh');
    expect(spec?.args).toEqual(['-c', 'make test']);
  });
});
