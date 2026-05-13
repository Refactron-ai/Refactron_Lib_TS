import { describe, it, expect } from 'vitest';
import { transform } from '../../../../../src/transform/transforms/typescript/promise-chains.js';

async function run(src: string, name = 'f.ts'): Promise<{
  newContent: string | null;
  preconditions: { id: string; satisfied: boolean; reason?: string }[];
}> {
  return transform({
    absPath: `/virtual/${name}`,
    relPath: name,
    source: src,
    findings: [],
  });
}

describe('promise_chains_to_async (typescript)', () => {
  it('rewrites a chained .then().then() into async + awaits', async () => {
    const src = [
      'function load(id: number) {',
      '  return fetchUser(id).then(user => fetchPosts(user)).then(posts => posts);',
      '}',
      '',
    ].join('\n');
    const r = await run(src);
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toMatch(/async\s+function\s+load/);
    expect(r.newContent).toContain('await fetchUser(id)');
    expect(r.newContent).toContain('await');
    expect(r.newContent).not.toContain('.then(');
  });

  it('rewrites a nested .then(p1 => other.then(p2 => ret)) shape', async () => {
    const src = [
      'function load(id: number) {',
      '  return fetchUser(id).then(user => fetchPosts(user).then(posts => posts));',
      '}',
      '',
    ].join('\n');
    const r = await run(src);
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toMatch(/async\s+function\s+load/);
    expect(r.newContent).toContain('await fetchUser(id)');
    expect(r.newContent).toContain('await fetchPosts(user)');
    expect(r.newContent).not.toContain('.then(');
  });

  it('skips functions that use Promise.all (hazard)', async () => {
    const src = [
      'function load(id: number) {',
      '  return Promise.all([a(), b()]).then(([x, y]) => x + y);',
      '}',
      '',
    ].join('\n');
    const r = await run(src);
    expect(r.newContent).toBeNull();
    expect(r.preconditions.some((p) => p.id === 'no-promise-combinator')).toBe(true);
  });

  it('skips functions that use .catch (hazard)', async () => {
    const src = [
      'function load(id: number) {',
      '  return fetchUser(id).then(u => u).catch(e => null);',
      '}',
      '',
    ].join('\n');
    const r = await run(src);
    expect(r.newContent).toBeNull();
    expect(r.preconditions.some((p) => p.id === 'no-catch')).toBe(true);
  });
});
