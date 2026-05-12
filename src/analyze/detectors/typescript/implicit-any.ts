// src/analyze/detectors/typescript/implicit-any.ts
import type { SyntaxNode } from 'tree-sitter';
import type { DetectorContext, DetectorFinding } from '../types.js';
import { register } from '../index.js';

const REMEDIATION = 2;

function paramNeedsType(p: SyntaxNode): boolean {
  if (p.type !== 'required_parameter' && p.type !== 'optional_parameter') return false;
  if (p.childForFieldName('type')) return false;
  if (p.childForFieldName('value')) return false;
  return true;
}

export function detect(ctx: DetectorContext): DetectorFinding[] {
  const findings: DetectorFinding[] = [];
  let counter = 0;

  function visit(node: SyntaxNode): void {
    if (
      node.type === 'function_declaration' ||
      node.type === 'function_expression' ||
      node.type === 'arrow_function' ||
      node.type === 'method_definition'
    ) {
      const params = node.childForFieldName('parameters');
      if (params) {
        for (const p of params.namedChildren) {
          if (paramNeedsType(p)) {
            findings.push({
              id: `any-${ctx.relPath}-${p.startPosition.row}-${counter++}`,
              file: ctx.relPath,
              line: p.startPosition.row + 1,
              transformId: 'implicit_any',
              remediationMinutes: REMEDIATION,
              confidence: 'low',
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

register({ transformId: 'implicit_any', lang: 'typescript', detect });
