// tests/unit/analyze/detectors/typescript/vue-set-delete.test.ts
//
// Tree-sitter pattern matcher tests for the vue_set_delete_to_assignment detector.

import { describe, it, expect } from 'vitest';
import { parseTypescript } from '../../../../../src/analyze/parser.js';
import { detect } from '../../../../../src/analyze/detectors/typescript/vue-set-delete.js';

const ctx = (s: string, relPath = 'a.ts') => ({
  absPath: `/x/${relPath}`,
  relPath,
  source: s,
  tree: parseTypescript(s, false),
});

describe('ts: vue-set-delete detector', () => {
  it('flags Vue.set(obj, k, v)', () => {
    expect(detect(ctx('Vue.set(obj, "k", v)\n'))).toHaveLength(1);
  });

  it('flags Vue.delete(obj, k)', () => {
    expect(detect(ctx('Vue.delete(obj, "k")\n'))).toHaveLength(1);
  });

  it('flags this.$set(obj, k, v)', () => {
    expect(detect(ctx('class C { f(){ this.$set(this.x, "k", 1); } }\n'))).toHaveLength(1);
  });

  it('flags this.$delete(obj, k)', () => {
    expect(detect(ctx('class C { f(){ this.$delete(this.x, "k"); } }\n'))).toHaveLength(1);
  });

  it('does not flag My.set(obj, k, v)', () => {
    expect(detect(ctx('My.set(obj, "k", 1)\n'))).toHaveLength(0);
  });

  it('does not flag lowercase vue.set(...)', () => {
    expect(detect(ctx('vue.set(obj, "k", 1)\n'))).toHaveLength(0);
  });

  it('does not flag this.set(...) (missing $)', () => {
    expect(detect(ctx('class C { f(){ this.set(obj, "k", 1); } }\n'))).toHaveLength(0);
  });

  it('emits medium confidence (Vue 2 / Vue 3 reactivity caveat)', () => {
    const f = detect(ctx('Vue.set(obj, "k", 1)\n'));
    expect(f[0]!.confidence).toBe('medium');
  });

  it('reports the line of the call', () => {
    const f = detect(ctx('// header\n\nVue.set(obj, "k", 1)\n'));
    expect(f[0]!.line).toBe(3);
  });
});
