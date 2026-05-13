import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { transform } from '../../../../../src/transform/transforms/python/class-to-dataclass.js';

async function file(source: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 't5-'));
  const p = path.join(dir, 'f.py');
  await fs.writeFile(p, source);
  return p;
}

describe('class_to_dataclass (python)', () => {
  it('converts pure-init class', async () => {
    const src =
      'class User:\n    def __init__(self, id, name, email):\n        self.id = id\n        self.name = name\n        self.email = email\n';
    const p = await file(src);
    const r = await transform({ absPath: p, relPath: 'f.py', source: src, findings: [] });
    expect(r.newContent).toContain('@dataclass');
    expect(r.newContent).toContain('class User:');
    expect(r.newContent).toContain('id: Any');
    expect(r.newContent).toContain('name: Any');
    expect(r.newContent).toContain('email: Any');
    expect(r.newContent).not.toContain('def __init__');
    expect(r.newContent).toContain('from dataclasses import dataclass');
  });

  it('precondition fails when class has extra method', async () => {
    const src =
      'class User:\n    def __init__(self, id):\n        self.id = id\n    def greet(self):\n        return self.id\n';
    const p = await file(src);
    const r = await transform({ absPath: p, relPath: 'f.py', source: src, findings: [] });
    expect(r.newContent).toBeNull();
  });

  it('precondition fails when init body is non-trivial', async () => {
    const src = 'class User:\n    def __init__(self, id):\n        self.id = id * 2\n';
    const p = await file(src);
    const r = await transform({ absPath: p, relPath: 'f.py', source: src, findings: [] });
    expect(r.newContent).toBeNull();
  });
});
