import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { transform } from '../../../../../src/transform/transforms/python/deprecated-api.js';
import { buildCrossFileContext } from '../../../../../src/transform/cross-file.js';
import type { ExtendedAnalysisReport } from '../../../../../src/analyze/engine.js';
import type { CrossFileContext } from '../../../../../src/transform/types.js';

async function file(source: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 't4-'));
  const p = path.join(dir, 'f.py');
  await fs.writeFile(p, source);
  return p;
}

async function projectWithExternal(
  externalSource: string,
): Promise<{ src: string; ctx: CrossFileContext }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 't4-xf-'));
  await fs.writeFile(
    path.join(root, 'legacy_http.py'),
    'import requests\n\ndef fetch(url):\n    return requests.get(url, timeout=5)\n',
  );
  await fs.mkdir(path.join(root, 'tests'));
  await fs.writeFile(path.join(root, 'tests', 'test_x.py'), externalSource);
  const report: ExtendedAnalysisReport = {
    root,
    findings: [],
    analyzedAt: new Date(),
    importGraph: new Map([
      ['legacy_http.py', new Set<string>()],
      ['tests/test_x.py', new Set<string>(['legacy_http.py'])],
    ]),
    callEdges: [],
  };
  const cf = await buildCrossFileContext(report, root);
  return { src: path.join(root, 'legacy_http.py'), ctx: cf };
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

describe('python: deprecated_api — cross-file', () => {
  it('skips when external file patches "<module>.requests.<method>" as a string', async () => {
    const { src, ctx } = await projectWithExternal(
      'import unittest.mock\nfrom unittest.mock import patch\n' +
        'def test_fetch():\n    with patch("legacy_http.requests.get", return_value=None):\n        pass\n',
    );
    const source = await fs.readFile(src, 'utf8');
    const r = await transform({
      absPath: src,
      relPath: 'legacy_http.py',
      source,
      findings: [],
      crossFile: ctx,
    });
    expect(r.newContent).toBeNull();
    expect(
      r.preconditions.some(
        (c) =>
          !c.satisfied &&
          c.id === 'external-string-refs:requests' &&
          /external/.test(c.reason ?? ''),
      ),
    ).toBe(true);
  });

  it('proceeds normally when no external refs exist', async () => {
    const { src, ctx } = await projectWithExternal('# no refs\n');
    const source = await fs.readFile(src, 'utf8');
    const r = await transform({
      absPath: src,
      relPath: 'legacy_http.py',
      source,
      findings: [],
      crossFile: ctx,
    });
    expect(r.newContent).toContain('import httpx');
    expect(r.newContent).toContain('httpx.get(url, timeout=5)');
  });

  it('skips when external file references "<module>.requests" in any context', async () => {
    const { src, ctx } = await projectWithExternal(
      'import legacy_http\nprint(legacy_http.requests)\n',
    );
    const source = await fs.readFile(src, 'utf8');
    const r = await transform({
      absPath: src,
      relPath: 'legacy_http.py',
      source,
      findings: [],
      crossFile: ctx,
    });
    expect(r.newContent).toBeNull();
    expect(
      r.preconditions.some((c) => !c.satisfied && c.id === 'external-string-refs:requests'),
    ).toBe(true);
  });
});
