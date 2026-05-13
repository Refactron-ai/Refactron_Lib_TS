// src/analyze/detectors/typescript/promise-constructor.ts
import type { SyntaxNode } from 'tree-sitter';
import type { DetectorContext, DetectorFinding } from '../types.js';
import { register } from '../index.js';

const REMEDIATION = 5;

export function detect(ctx: DetectorContext): DetectorFinding[] {
  const findings: DetectorFinding[] = [];
  let counter = 0;

  function visit(node: SyntaxNode): void {
    if (node.type === 'new_expression') {
      const ctor = node.childForFieldName('constructor');
      if (ctor && ctor.type === 'identifier' && ctor.text === 'Promise') {
        findings.push({
          id: `pc-${ctx.relPath}-${node.startPosition.row}-${counter++}`,
          file: ctx.relPath,
          line: node.startPosition.row + 1,
          transformId: 'promise_constructor_to_async',
          remediationMinutes: REMEDIATION,
          confidence: 'medium',
        });
      }
    }
    for (const c of node.namedChildren) visit(c);
  }
  visit(ctx.tree.rootNode);
  return findings;
}

register({ transformId: 'promise_constructor_to_async', lang: 'typescript', detect });
