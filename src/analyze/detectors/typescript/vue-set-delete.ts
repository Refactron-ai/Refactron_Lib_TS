// src/analyze/detectors/typescript/vue-set-delete.ts
//
// Flags Vue 2 reactivity helper calls — Vue.set / Vue.delete / this.$set /
// this.$delete — that the `vue_set_delete_to_assignment` transform can
// (under the assumed-Vue-3 reactivity model) rewrite to plain assignment or
// `delete` expressions.
//
// Confidence: MEDIUM because the rewrite is a semantic change on Vue 2
// codebases (Object.defineProperty reactivity requires Vue.set to add NEW
// reactive keys). The transform always surfaces an informational
// `assumes_vue3_reactivity` precondition, but reviewers must vet diff-by-diff.
//
// Scope: .js / .ts only. .vue SFCs are NEVER visited by the file walker
// (`src/analyze/discovery.ts` -> `langOf` only matches .py/.ts/.tsx/.js/.jsx),
// so no extra filtering is needed at the detector level — but the transform
// guards on `.vue` paths anyway in case the engine ever changes.

import type { SyntaxNode } from 'tree-sitter';
import type { DetectorContext, DetectorFinding } from '../types.js';
import { register } from '../index.js';

const REMEDIATION = 2;

/** Returns the operation type if `fn` is one of:
 *   - Vue.set / Vue.delete    (member_expression: identifier "Vue" . property)
 *   - this.$set / this.$delete (member_expression: this . property)
 *  otherwise null. */
function classifyCallee(fn: SyntaxNode): 'set' | 'delete' | null {
  if (fn.type !== 'member_expression') return null;
  const obj = fn.childForFieldName('object');
  const prop = fn.childForFieldName('property');
  if (!obj || !prop) return null;

  // Vue.set / Vue.delete
  if (obj.type === 'identifier' && obj.text === 'Vue') {
    if (prop.text === 'set') return 'set';
    if (prop.text === 'delete') return 'delete';
    return null;
  }

  // this.$set / this.$delete
  if (obj.type === 'this') {
    if (prop.text === '$set') return 'set';
    if (prop.text === '$delete') return 'delete';
    return null;
  }

  return null;
}

export function detect(ctx: DetectorContext): DetectorFinding[] {
  const findings: DetectorFinding[] = [];
  let counter = 0;

  function visit(node: SyntaxNode): void {
    if (node.type === 'call_expression') {
      const fn = node.childForFieldName('function');
      if (fn) {
        const op = classifyCallee(fn);
        if (op !== null) {
          findings.push({
            id: `vue-${op}-${ctx.relPath}-${node.startPosition.row}-${counter++}`,
            file: ctx.relPath,
            line: node.startPosition.row + 1,
            transformId: 'vue_set_delete_to_assignment',
            remediationMinutes: REMEDIATION,
            confidence: 'medium',
          });
        }
      }
    }
    for (const c of node.namedChildren) visit(c);
  }
  visit(ctx.tree.rootNode);
  return findings;
}

register({ transformId: 'vue_set_delete_to_assignment', lang: 'typescript', detect });
