// tests/unit/cli/runner-scope.test.ts
// Tests for the scopePlanChanges helper that backs `run <target>` filtering.
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { scopePlanChanges } from '../../../src/cli/runner.js';
import type { FileChange } from '../../../src/contracts.js';

function ch(p: string): FileChange {
  return { path: p, oldHash: 'x', newContent: '', transformId: 'format_to_fstring' };
}

const projectRoot = path.resolve('/tmp/proj');

describe('scopePlanChanges', () => {
  it('with a file scope, returns only the exact path match', () => {
    const target = path.join(projectRoot, 'a.py');
    const changes = [
      ch(path.join(projectRoot, 'a.py')),
      ch(path.join(projectRoot, 'b.py')),
      ch(path.join(projectRoot, 'sub', 'a.py')),
    ];
    const out = scopePlanChanges(changes, target, true);
    expect(out).toHaveLength(1);
    expect(out[0]!.path).toBe(target);
  });

  it('with a directory scope, returns every change beneath it (inclusive)', () => {
    const sub = path.join(projectRoot, 'sub');
    const changes = [
      ch(path.join(projectRoot, 'a.py')),
      ch(path.join(sub, 'b.py')),
      ch(path.join(sub, 'nested', 'c.py')),
      ch(path.join(projectRoot, 'other', 'd.py')),
    ];
    const out = scopePlanChanges(changes, sub, false);
    expect(out.map((c) => c.path).sort()).toEqual(
      [path.join(sub, 'b.py'), path.join(sub, 'nested', 'c.py')].sort(),
    );
  });

  it('directory scope does not match the directory itself', () => {
    const sub = path.join(projectRoot, 'sub');
    const out = scopePlanChanges([ch(sub)], sub, false);
    expect(out).toHaveLength(0);
  });

  it('directory scope rejects siblings whose relative path starts with ..', () => {
    const sub = path.join(projectRoot, 'sub');
    const sibling = path.join(projectRoot, 'sub2', 'x.py');
    const out = scopePlanChanges([ch(sibling)], sub, false);
    expect(out).toHaveLength(0);
  });

  it('file scope rejects directory-children of a file path', () => {
    // (Doesn't really happen in practice, but verifies the file-equality branch
    // doesn't accidentally fall through.)
    const filePath = path.join(projectRoot, 'a.py');
    const out = scopePlanChanges([ch(path.join(projectRoot, 'a.py', 'b.py'))], filePath, true);
    expect(out).toHaveLength(0);
  });
});
