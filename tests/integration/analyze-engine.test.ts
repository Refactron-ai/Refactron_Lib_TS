import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { RefactronAnalyzer } from '../../src/analyze/engine.js';

const PY = path.resolve('fixtures/python-legacy-mini');
const TS = path.resolve('fixtures/ts-legacy-mini');

const PY_TRANSFORMS = new Set([
  'callback_to_async_await',
  'format_to_fstring',
  'manual_typecheck_to_hints',
  'deprecated_api_requests_to_httpx',
  'class_to_dataclass',
]);

const TS_TRANSFORMS = new Set([
  'var_to_const_let',
  'promise_chains_to_async',
  'implicit_any',
  'commonjs_to_esm',
  'promise_constructor_to_async',
]);

describe('RefactronAnalyzer on legacy-mini fixtures', () => {
  it('detects every Python transform pattern in python-legacy-mini in <5s', async () => {
    const a = new RefactronAnalyzer({ confidence: 'low' });
    const t0 = Date.now();
    const report = await a.analyzeExtended(PY);
    expect(Date.now() - t0).toBeLessThan(5000);
    const ids = new Set(report.findings.map((f) => f.transformId));
    for (const t of PY_TRANSFORMS) expect(ids).toContain(t);
  });

  it('detects every TS transform pattern in ts-legacy-mini in <5s', async () => {
    const a = new RefactronAnalyzer({ confidence: 'low' });
    const t0 = Date.now();
    const report = await a.analyzeExtended(TS);
    expect(Date.now() - t0).toBeLessThan(5000);
    const ids = new Set(report.findings.map((f) => f.transformId));
    for (const t of TS_TRANSFORMS) expect(ids).toContain(t);
  });

  it('builds an import graph for the python fixture', async () => {
    const a = new RefactronAnalyzer();
    const report = await a.analyzeExtended(PY);
    expect(report.importGraph.size).toBeGreaterThan(0);
  });
});
