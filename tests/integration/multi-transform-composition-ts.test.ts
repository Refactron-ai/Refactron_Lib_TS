// tests/integration/multi-transform-composition-ts.test.ts
//
// Verifies the in-process `currentText`-threading composition fix (PR #38)
// works for multiple TypeScript transforms applied to the same file:
//   - indexof_to_includes
//   - object_assign_to_spread
//   - string_concat_to_template_literal
//   - vue_set_delete_to_assignment  (Phase 5)
//
// Each transform must see the output of the previous one and the final
// FileChange must contain all rewrites.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { RefactronAnalyzer } from '../../src/analyze/engine.js';
import { RefactronRefactorer } from '../../src/transform/engine.js';

const FIXTURE = `const arr: number[] = [1, 2, 3];
const who: string = "world";
const a = { x: 1 };
const b = { y: 2 };
const reactive: Record<string, number> = {};
declare const Vue: { set: (o: object, k: string, v: number) => void };

function check(): void {
  if (arr.indexOf(2) !== -1) {
    const greeting = "Hello " + who + "!";
    const merged = Object.assign({}, a, b);
    Vue.set(reactive, "foo", 1);
    console.log(greeting, merged);
  }
}
`;

async function fixtureProject(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ts-multi-tx-'));
  await fs.writeFile(path.join(root, 'sample.ts'), FIXTURE, 'utf8');
  // Modern ES target so all three transforms' version gates pass.
  await fs.writeFile(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { target: 'ES2020' } }, null, 2),
    'utf8',
  );
  return root;
}

describe('multi-transform composition (typescript)', () => {
  it('threads currentText across four TS transforms on the same file', async () => {
    const root = await fixtureProject();
    try {
      const analyzer = new RefactronAnalyzer({ confidence: 'low' });
      const report = await analyzer.analyzeExtended(root);
      const refactorer = new RefactronRefactorer({ projectRoot: root });
      const plan = await refactorer.plan(report, [
        'indexof_to_includes',
        'object_assign_to_spread',
        'string_concat_to_template_literal',
        'vue_set_delete_to_assignment',
      ]);

      const samplePath = path.join(root, 'sample.ts');
      const changes = plan.changes.filter((c) => c.path === samplePath);

      // All four transforms emitted a FileChange.
      expect(changes.length).toBe(4);
      const transformIds = new Set(changes.map((c) => c.transformId));
      expect(transformIds.has('indexof_to_includes')).toBe(true);
      expect(transformIds.has('object_assign_to_spread')).toBe(true);
      expect(transformIds.has('string_concat_to_template_literal')).toBe(true);
      expect(transformIds.has('vue_set_delete_to_assignment')).toBe(true);

      // The LAST change holds the cumulative content of all four.
      const final = changes[changes.length - 1]!.newContent;
      expect(final).toContain('arr.includes(2)');
      expect(final).not.toMatch(/arr\.indexOf\(2\)\s*!==\s*-1/);
      expect(final).toContain('{ ...a, ...b }');
      expect(final).not.toContain('Object.assign({}');
      expect(final).toContain('`Hello ${who}!`');
      expect(final).not.toMatch(/"Hello " \+ who \+ "!"/);
      expect(final).toContain('reactive.foo = 1');
      expect(final).not.toContain('Vue.set(');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 60_000);
});
