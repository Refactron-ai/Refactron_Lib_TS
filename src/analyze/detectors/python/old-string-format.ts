// src/analyze/detectors/python/old-string-format.ts
import type { SyntaxNode } from 'tree-sitter';
import type { DetectorContext, DetectorFinding } from '../types.js';
import { register } from '../index.js';

const REMEDIATION = 2;

export function detect(ctx: DetectorContext): DetectorFinding[] {
  const findings: DetectorFinding[] = [];
  let counter = 0;

  function visit(node: SyntaxNode): void {
    if (node.type === 'binary_operator' && node.childForFieldName('operator')?.text === '%') {
      const lhs = node.childForFieldName('left');
      if (lhs && lhs.type === 'string') {
        findings.push({
          id: `fmt-${ctx.relPath}-${node.startPosition.row}-${counter++}`,
          file: ctx.relPath,
          line: node.startPosition.row + 1,
          transformId: 'format_to_fstring',
          remediationMinutes: REMEDIATION,
          confidence: 'high',
        });
      }
    }
    if (node.type === 'call') {
      const fn = node.childForFieldName('function');
      if (fn && fn.type === 'attribute') {
        const obj = fn.childForFieldName('object');
        const attr = fn.childForFieldName('attribute');
        if (obj && obj.type === 'string' && attr && attr.text === 'format') {
          findings.push({
            id: `fmt-${ctx.relPath}-${node.startPosition.row}-${counter++}`,
            file: ctx.relPath,
            line: node.startPosition.row + 1,
            transformId: 'format_to_fstring',
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

register({ transformId: 'format_to_fstring', lang: 'python', detect });
