// tests/unit/transform/transforms/typescript/vue-set-delete.test.ts
//
// Tests for the `vue_set_delete_to_assignment` transform. Covers:
//   - Vue.set / this.$set    → assignment expression (dot vs bracket key)
//   - Vue.delete / this.$delete → delete expression
//   - statement vs expression context (paren-wrapping for assignment;
//     hard refusal for delete in expression context)
//   - reserved-word string keys preserve bracket notation (including
//     TypeScript strict-mode reserved words like `interface`)
//   - wrong arity refused
//   - .vue SFC refused
//   - no informational `assumes_vue3_reactivity` precondition — that caveat
//     lives in the suggestion text, not in preconditions
//   - idempotent on already-rewritten code

import { describe, it, expect } from 'vitest';
import { transform } from '../../../../../src/transform/transforms/typescript/vue-set-delete.js';

async function run(src: string, name = 'f.ts'): ReturnType<typeof transform> {
  return transform({
    absPath: `/tmp/${name}`,
    relPath: name,
    source: src,
    findings: [],
  });
}

describe('vue_set_delete_to_assignment (typescript)', () => {
  it('rewrites Vue.set with a string-literal identifier key to dot notation', async () => {
    const r = await run('const obj: Record<string, number> = {};\nVue.set(obj, "foo", 1);\n');
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('obj.foo = 1');
    expect(r.newContent).not.toContain('Vue.set');
  });

  it('rewrites Vue.set with a non-ident string key using bracket notation', async () => {
    const r = await run('const obj: Record<string, number> = {};\nVue.set(obj, "foo bar", 1);\n');
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('obj["foo bar"] = 1');
  });

  it('rewrites Vue.set with an identifier key using bracket notation', async () => {
    const r = await run(
      'const obj: Record<string, unknown> = {}; const key = "k"; const value = 1;\nVue.set(obj, key, value);\n',
    );
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('obj[key] = value');
  });

  it('rewrites Vue.set with a numeric literal key using bracket notation', async () => {
    const r = await run('const obj: Record<number, string> = {};\nVue.set(obj, 0, "x");\n');
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('obj[0] = "x"');
  });

  it('rewrites this.$set on this.items[idx]', async () => {
    const src = `class C {
  items: unknown[] = [];
  update(idx: number, item: unknown): void {
    this.$set(this.items, idx, item);
  }
}
`;
    const r = await run(src);
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('this.items[idx] = item');
    expect(r.newContent).not.toContain('this.$set');
  });

  it('rewrites Vue.delete with ident-string key to dot notation', async () => {
    const r = await run(
      'const obj: Record<string, number> = { foo: 1 };\nVue.delete(obj, "foo");\n',
    );
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('delete obj.foo');
    expect(r.newContent).not.toContain('Vue.delete');
  });

  it('rewrites Vue.delete with non-ident string key using bracket', async () => {
    const r = await run('const obj: Record<string, number> = {};\nVue.delete(obj, "foo bar");\n');
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('delete obj["foo bar"]');
  });

  it('rewrites this.$delete with a bracket-notation key expression', async () => {
    const src = `class C {
  items: unknown[] = [];
  remove(idx: number): void {
    this.$delete(this.items, idx);
  }
}
`;
    const r = await run(src);
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('delete this.items[idx]');
  });

  it('wraps Vue.set in parens when used in expression context', async () => {
    const r = await run(
      'const obj: Record<string, number> = {}; const v = 1;\nconst x = Vue.set(obj, "k", v);\n',
    );
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('const x = (obj.k = v)');
  });

  it('refuses Vue.delete in expression context with delete_in_expression_context', async () => {
    const r = await run(
      'const obj: Record<string, number> = { k: 1 };\nconst x = Vue.delete(obj, "k");\n',
    );
    expect(r.newContent).toBeNull();
    expect(r.preconditions.some((p) => p.id === 'delete_in_expression_context')).toBe(true);
  });

  it('refuses Vue.set with wrong arity (2 args)', async () => {
    const r = await run('declare const Vue: any;\nVue.set(obj, "k");\n');
    expect(r.newContent).toBeNull();
    expect(r.preconditions.some((p) => p.id === 'wrong_arity')).toBe(true);
  });

  it('refuses Vue.delete with wrong arity (3 args)', async () => {
    const r = await run('declare const Vue: any;\nVue.delete(obj, "k", "extra");\n');
    expect(r.newContent).toBeNull();
    expect(r.preconditions.some((p) => p.id === 'wrong_arity')).toBe(true);
  });

  it('keeps bracket notation when the string key is a reserved word', async () => {
    const r = await run('const obj: Record<string, number> = {};\nVue.set(obj, "class", 1);\n');
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('obj["class"] = 1');
    expect(r.newContent).not.toContain('obj.class');
  });

  it('refuses .vue SFCs with vue_sfc_not_supported', async () => {
    const r = await run(
      'export default { methods: { foo() { Vue.set(this.x, "k", 1); } } }\n',
      'App.vue',
    );
    expect(r.newContent).toBeNull();
    expect(r.preconditions.some((p) => p.id === 'vue_sfc_not_supported')).toBe(true);
  });

  it('preserves surrounding code when only the call site is rewritten', async () => {
    const src = `const obj: Record<string, number> = {};
function helper(): number { return 42; }
Vue.set(obj, "foo", 1);
const z = helper();
`;
    const r = await run(src);
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('function helper(): number { return 42; }');
    expect(r.newContent).toContain('const z = helper()');
    expect(r.newContent).toContain('obj.foo = 1');
  });

  it('returns no changes when there are no Vue.set/delete calls', async () => {
    const r = await run('const x = 1;\nconst y = { a: 1 };\n');
    expect(r.newContent).toBeNull();
  });

  it('does NOT emit an assumes_vue3_reactivity precondition (caveat lives in the suggestion text)', async () => {
    // The Vue 2 / Vue 3 reactivity caveat is surfaced via
    // SUGGESTION_BY_TRANSFORM['vue_set_delete_to_assignment'] in
    // src/cli/v2-adapters.ts — NOT via a precondition. The `Precondition`
    // contract is binary (satisfied / not satisfied) with no informational
    // severity, so encoding a caveat as `satisfied: true` would be a misuse.
    const r = await run('const obj: Record<string, number> = {};\nVue.set(obj, "foo", 1);\n');
    expect(r.newContent).not.toBeNull();
    expect(r.preconditions.find((p) => p.id === 'assumes_vue3_reactivity')).toBeUndefined();
  });

  it('keeps bracket notation when the string key is a TypeScript strict-mode reserved word (interface)', async () => {
    const r = await run('const obj: Record<string, number> = {};\nVue.set(obj, "interface", 1);\n');
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('obj["interface"] = 1');
    expect(r.newContent).not.toContain('obj.interface');
  });

  it('is idempotent on already-rewritten code (no Vue.set/$set calls means no changes)', async () => {
    // Structurally guaranteed: the detector only matches `Vue.set` / $set call
    // shapes, so a plain assignment is never re-touched. This test documents
    // the guarantee and matches the no-op pattern in indexof-to-includes.test.ts.
    const r = await run('const obj: Record<string, number> = {};\nobj.foo = 1;\n');
    expect(r.newContent).toBeNull();
  });
});
