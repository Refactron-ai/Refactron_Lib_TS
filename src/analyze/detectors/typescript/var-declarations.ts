// src/analyze/detectors/typescript/var-declarations.ts
import type { SyntaxNode } from 'tree-sitter';
import type { DetectorContext, DetectorFinding, Confidence } from '../types.js';
import { register } from '../index.js';

const REMEDIATION = 1;

function isReassigned(root: SyntaxNode, name: string): boolean {
  let found = false;
  function visit(n: SyntaxNode): void {
    if (found) return;
    if (n.type === 'assignment_expression') {
      const lhs = n.childForFieldName('left');
      if (lhs && lhs.type === 'identifier' && lhs.text === name) found = true;
    }
    if (n.type === 'update_expression') {
      const arg = n.childForFieldName('argument');
      if (arg && arg.type === 'identifier' && arg.text === name) found = true;
    }
    for (const c of n.namedChildren) visit(c);
  }
  visit(root);
  return found;
}

export function detect(ctx: DetectorContext): DetectorFinding[] {
  const findings: DetectorFinding[] = [];
  let counter = 0;

  function visit(node: SyntaxNode): void {
    if (node.type === 'variable_declaration') {
      const kw = node.children[0]?.text;
      if (kw === 'var') {
        const declarators = node.namedChildren.filter((c) => c.type === 'variable_declarator');
        for (const decl of declarators) {
          const id = decl.childForFieldName('name');
          const name = id?.text;
          const confidence: Confidence =
            name && isReassigned(ctx.tree.rootNode, name) ? 'medium' : 'high';
          findings.push({
            id: `var-${ctx.relPath}-${decl.startPosition.row}-${counter++}`,
            file: ctx.relPath,
            line: decl.startPosition.row + 1,
            transformId: 'var_to_const_let',
            remediationMinutes: REMEDIATION,
            confidence,
          });
        }
      }
    }
    for (const c of node.namedChildren) visit(c);
  }
  visit(ctx.tree.rootNode);
  return findings;
}

register({ transformId: 'var_to_const_let', lang: 'typescript', detect });
