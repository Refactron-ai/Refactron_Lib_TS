import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { transform } from '../../../../../src/transform/transforms/python/deprecated-api.js';

async function file(source: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 't4-'));
  const p = path.join(dir, 'f.py');
  await fs.writeFile(p, source);
  return p;
}

describe('deprecated_api_requests_to_httpx (python)', () => {
  it('rewrites import + attribute call', async () => {
    const src =
      'import requests\n\ndef fetch(url):\n    r = requests.get(url, timeout=5)\n    return r\n';
    const p = await file(src);
    const r = await transform({ absPath: p, relPath: 'f.py', source: src, findings: [] });
    expect(r.newContent).toContain('import httpx');
    expect(r.newContent).toContain('httpx.get(url, timeout=5)');
    expect(r.newContent).not.toMatch(/\brequests\./);
  });

  it('rewrites from-import', async () => {
    const src = 'from requests import get\n\ndef f(url):\n    return get(url)\n';
    const p = await file(src);
    const r = await transform({ absPath: p, relPath: 'f.py', source: src, findings: [] });
    expect(r.newContent).toContain('from httpx import get');
  });

  it('precondition fails when target already imported', async () => {
    const src = 'import httpx\nimport requests\n';
    const p = await file(src);
    const r = await transform({ absPath: p, relPath: 'f.py', source: src, findings: [] });
    expect(r.newContent).toBeNull();
    expect(
      r.preconditions.some((c) => !c.satisfied && /already imported/.test(c.reason ?? '')),
    ).toBe(true);
  });
});
