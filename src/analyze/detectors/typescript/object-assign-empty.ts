// src/analyze/detectors/typescript/object-assign-empty.ts
//
// Flags `Object.assign({...}, ...)` calls where the FIRST argument is an
// object literal — those are the calls the `object_assign_to_spread`
// transform can safely rewrite. Calls with a mutable target like
// `Object.assign(myObj, src)` are intentionally skipped because rewriting
// them would change the returned identity (`myObj` is no longer mutated).

import type { SyntaxNode } from 'tree-sitter';
import type { DetectorContext, DetectorFinding } from '../types.js';
import { register } from '../index.js';

const REMEDIATION = 2;

/** Returns true iff `fn` is the member access `Object.assign`. */
function isObjectAssignCallee(fn: SyntaxNode): boolean {
  if (fn.type !== 'member_expression') return false;
  const obj = fn.childForFieldName('object');
  const prop = fn.childForFieldName('property');
  if (!obj || !prop) return false;
  if (prop.text !== 'assign') return false;
  return obj.type === 'identifier' && obj.text === 'Object';
}

/** True iff `node` is an `{}` or `{ a: 1, b: 2 }` style literal (no parens). */
function isObjectLiteral(node: SyntaxNode): boolean {
  let n: SyntaxNode = node;
  while (n.type === 'parenthesized_expression') {
    const inner = n.namedChildren[0];
    if (!inner) return false;
    n = inner;
  }
  return n.type === 'object';
}

export function detect(ctx: DetectorContext): DetectorFinding[] {
  const findings: DetectorFinding[] = [];
  let counter = 0;

  function visit(node: SyntaxNode): void {
    if (node.type === 'call_expression') {
      const fn = node.childForFieldName('function');
      const args = node.childForFieldName('arguments');
      if (fn && args && isObjectAssignCallee(fn)) {
        const realArgs = args.namedChildren.filter((c) => c.type !== 'comment');
        if (realArgs.length >= 1 && isObjectLiteral(realArgs[0]!)) {
          findings.push({
            id: `object-assign-${ctx.relPath}-${node.startPosition.row}-${counter++}`,
            file: ctx.relPath,
            line: node.startPosition.row + 1,
            transformId: 'object_assign_to_spread',
            remediationMinutes: REMEDIATION,
            confidence: 'high',
          });
        }
      }
    }
    for (const c of node.namedChildren) visit(c);
  }
  visit(ctx.tree.rootNode);
  return findings;
}

register({ transformId: 'object_assign_to_spread', lang: 'typescript', detect });
