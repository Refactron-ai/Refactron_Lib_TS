// src/analyze/detectors/python/old-string-format.ts
import type { SyntaxNode } from 'tree-sitter';
import type { DetectorContext, DetectorFinding } from '../types.js';
import { register } from '../index.js';

const REMEDIATION = 2;

export function detect(ctx: DetectorContext): DetectorFinding[] {
  const findings: DetectorFinding[] = [];
  let counter = 0;

  // Attribute the finding to the formatting OPERATION, not the string literal.
  // A multi-line `"""…""" % args` / `"""…""".format(…)` site starts at the
  // opening `"""`, which can be many lines above the `%` / `.format()`; using
  // the literal's row makes the finding point at a line with no visible
  // formatting at all. Anchor on the operator / `.format` token instead.
  function push(row: number): void {
    findings.push({
      id: `fmt-${ctx.relPath}-${row}-${counter++}`,
      file: ctx.relPath,
      line: row + 1,
      transformId: 'format_to_fstring',
      remediationMinutes: REMEDIATION,
      confidence: 'high',
    });
  }

  function visit(node: SyntaxNode): void {
    if (node.type === 'binary_operator') {
      const op = node.childForFieldName('operator');
      const lhs = node.childForFieldName('left');
      if (op?.text === '%' && lhs && lhs.type === 'string') {
        push(op.startPosition.row);
      }
    }
    if (node.type === 'call') {
      const fn = node.childForFieldName('function');
      if (fn && fn.type === 'attribute') {
        const obj = fn.childForFieldName('object');
        const attr = fn.childForFieldName('attribute');
        if (obj && obj.type === 'string' && attr && attr.text === 'format') {
          push(attr.startPosition.row);
        }
      }
    }
    for (const c of node.namedChildren) visit(c);
  }
  visit(ctx.tree.rootNode);
  return findings;
}

register({ transformId: 'format_to_fstring', lang: 'python', detect });
