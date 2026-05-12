import { describe, it, expect } from 'vitest';

import { sumTo, makeGreeting } from '../vars';
import { loadProfile } from '../chains';
import { add } from '../untyped';
import { delayedValue } from '../promises';
import { repeat } from '../utils';

// CommonJS interop module — its module.exports surface is exposed as `default`
// under esModuleInterop, so we grab that.
import cjsModule from '../commonjs';
const cjs: { join: (a: string, b: string) => string } = cjsModule as any;

describe('vars.ts', () => {
  it('sumTo accumulates with a reassigned counter', () => {
    expect(sumTo(5)).toBe(15);
  });

  it('makeGreeting builds from a never-reassigned local', () => {
    expect(makeGreeting('ada')).toBe('hi, ada');
  });
});

describe('chains.ts', () => {
  it('loadProfile resolves user and posts via promise chain', async () => {
    const result = await loadProfile(7);
    expect(result.user).toEqual({ id: 7, name: 'user-7' });
    expect(result.posts).toHaveLength(2);
    expect(result.posts[0].userId).toBe(7);
  });
});

describe('untyped.ts', () => {
  it('add returns numeric sum for numbers', () => {
    expect(add(2, 3)).toBe(5);
  });
});

describe('commonjs.ts', () => {
  it('join concatenates path segments', () => {
    expect(cjs.join('a', 'b')).toBe('a/b');
  });
});

describe('promises.ts', () => {
  it('delayedValue resolves with the supplied value', async () => {
    const v = await delayedValue('done', 5);
    expect(v).toBe('done');
  });
});

describe('utils.ts', () => {
  it('repeat concatenates n times', () => {
    expect(repeat('ab', 3)).toBe('ababab');
  });
});
