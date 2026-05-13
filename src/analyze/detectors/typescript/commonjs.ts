// src/analyze/detectors/typescript/commonjs.ts
import type { SyntaxNode } from 'tree-sitter';
import type { DetectorContext, DetectorFinding } from '../types.js';
import { register } from '../index.js';

const REMEDIATION = 2;

export function detect(ctx: DetectorContext): DetectorFinding[] {
  const findings: DetectorFinding[] = [];
  let counter = 0;

  function add(node: SyntaxNode): void {
    findings.push({
      id: `cjs-${ctx.relPath}-${node.startPosition.row}-${counter++}`,
      file: ctx.relPath,
      line: node.startPosition.row + 1,
      transformId: 'commonjs_to_esm',
      remediationMinutes: REMEDIATION,
      confidence: 'high',
    });
  }

  function visit(node: SyntaxNode): void {
    if (node.type === 'call_expression') {
      const fn = node.childForFieldName('function');
      if (fn && fn.type === 'identifier' && fn.text === 'require') add(node);
    }
    if (node.type === 'assignment_expression') {
      const lhs = node.childForFieldName('left');
      if (lhs && lhs.type === 'member_expression') {
        const obj = lhs.childForFieldName('object');
        const prop = lhs.childForFieldName('property');
        if (obj?.text === 'module' && prop?.text === 'exports') add(node);
        else if (obj?.text === 'exports') add(node);
      }
    }
    for (const c of node.namedChildren) visit(c);
  }
  visit(ctx.tree.rootNode);
  return findings;
}

register({ transformId: 'commonjs_to_esm', lang: 'typescript', detect });
