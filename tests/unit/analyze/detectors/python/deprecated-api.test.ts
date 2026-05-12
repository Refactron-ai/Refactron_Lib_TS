import { describe, it, expect } from 'vitest';
import { parsePython } from '../../../../../src/analyze/parser.js';
import { detect } from '../../../../../src/analyze/detectors/python/deprecated-api.js';

const ctx = (s: string) => ({ absPath: '/x/a.py', relPath: 'a.py', source: s, tree: parsePython(s) });

describe('python: deprecated-api (requests)', () => {
  it('flags `import requests`', () => {
    const f = detect(ctx('import requests\n'));
    expect(f.length).toBe(1);
    expect(f[0]!.transformId).toBe('deprecated_api_requests_to_httpx');
  });
  it('flags requests.get call', () => {
    expect(detect(ctx('import requests\nrequests.get("x")\n')).length).toBeGreaterThanOrEqual(1);
  });
  it('does not flag unrelated calls', () => {
    expect(detect(ctx('import json\njson.dumps({})\n'))).toHaveLength(0);
  });
});
