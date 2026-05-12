// src/analyze/detectors/typescript/promise-chains.ts
import type { SyntaxNode } from 'tree-sitter';
import type { DetectorContext, DetectorFinding } from '../types.js';
import { register } from '../index.js';

const REMEDIATION = 3;

function countThens(node: SyntaxNode): number {
  let count = 0;
  let cursor: SyntaxNode | null = node;
  while (cursor && cursor.type === 'call_expression') {
    const fn = cursor.childForFieldName('function');
    if (fn && fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property');
      if (prop?.text === 'then') count++;
      cursor = fn.childForFieldName('object');
    } else break;
  }
  return count;
}

export function detect(ctx: DetectorContext): DetectorFinding[] {
  const findings: DetectorFinding[] = [];
  let counter = 0;

  function visit(node: SyntaxNode): void {
    if (node.type === 'call_expression') {
      const fn = node.childForFieldName('function');
      if (fn && fn.type === 'member_expression' && fn.childForFieldName('property')?.text === 'then') {
        const parent = node.parent;
        const isOuter = !(
          parent &&
          parent.type === 'member_expression' &&
          parent.parent?.type === 'call_expression'
        );
        if (isOuter) {
          const total = countThens(node);
          if (total >= 2) {
            findings.push({
              id: `then-${ctx.relPath}-${node.startPosition.row}-${counter++}`,
              file: ctx.relPath,
              line: node.startPosition.row + 1,
              transformId: 'promise_chains_to_async',
              remediationMinutes: REMEDIATION,
              confidence: 'medium',
            });
          }
        }
      }
    }
    for (const c of node.namedChildren) visit(c);
  }
  visit(ctx.tree.rootNode);
  return findings;
}

register({ transformId: 'promise_chains_to_async', lang: 'typescript', detect });
