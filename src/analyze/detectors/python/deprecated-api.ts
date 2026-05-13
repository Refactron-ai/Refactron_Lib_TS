// src/analyze/detectors/python/deprecated-api.ts
import type { SyntaxNode } from 'tree-sitter';
import type { DetectorContext, DetectorFinding } from '../types.js';
import { register } from '../index.js';

const REMEDIATION = 4;

export function detect(ctx: DetectorContext): DetectorFinding[] {
  const findings: DetectorFinding[] = [];
  let counter = 0;

  function add(node: SyntaxNode, confidence: 'high' | 'medium'): void {
    findings.push({
      id: `req-${ctx.relPath}-${node.startPosition.row}-${counter++}`,
      file: ctx.relPath,
      line: node.startPosition.row + 1,
      transformId: 'deprecated_api_requests_to_httpx',
      remediationMinutes: REMEDIATION,
      confidence,
    });
  }

  function visit(node: SyntaxNode): void {
    if (node.type === 'import_statement') {
      for (const child of node.namedChildren) {
        let name: string | null = null;
        if (child.type === 'dotted_name') name = child.text;
        else if (child.type === 'aliased_import')
          name = child.childForFieldName('name')?.text ?? null;
        if (name === 'requests') add(node, 'high');
      }
    }
    if (node.type === 'import_from_statement') {
      const mod = node.childForFieldName('module_name');
      if (mod?.text === 'requests') add(node, 'high');
    }
    if (node.type === 'call') {
      const fn = node.childForFieldName('function');
      if (fn?.type === 'attribute') {
        const obj = fn.childForFieldName('object');
        if (obj?.type === 'identifier' && obj.text === 'requests') add(node, 'medium');
      }
    }
    for (const c of node.namedChildren) visit(c);
  }
  visit(ctx.tree.rootNode);
  return findings;
}

register({ transformId: 'deprecated_api_requests_to_httpx', lang: 'python', detect });
