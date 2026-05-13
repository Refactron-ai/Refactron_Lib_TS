// src/analyze/detectors/python/class-init-only.ts
import type { SyntaxNode } from 'tree-sitter';
import type { DetectorContext, DetectorFinding } from '../types.js';
import { register } from '../index.js';

const REMEDIATION = 3;

export function detect(ctx: DetectorContext): DetectorFinding[] {
  const findings: DetectorFinding[] = [];
  let counter = 0;

  function visit(node: SyntaxNode): void {
    if (node.type === 'class_definition') {
      const body = node.childForFieldName('body');
      if (body) {
        const methods = body.namedChildren.filter((c) => c.type === 'function_definition');
        if (methods.length === 1 && methods[0]!.childForFieldName('name')?.text === '__init__') {
          const init = methods[0]!;
          const params = init.childForFieldName('parameters');
          const initBody = init.childForFieldName('body');
          if (params && initBody) {
            const paramNames = params.namedChildren
              .filter((p) => p.type === 'identifier' && p.text !== 'self')
              .map((p) => p.text);
            const stmts = initBody.namedChildren;
            const matches =
              stmts.length === paramNames.length &&
              stmts.every((stmt, i) => {
                if (stmt.type !== 'expression_statement') return false;
                const assign = stmt.namedChild(0);
                if (!assign || assign.type !== 'assignment') return false;
                const lhs = assign.childForFieldName('left');
                const rhs = assign.childForFieldName('right');
                return (
                  lhs?.text === `self.${paramNames[i]!}` &&
                  rhs?.type === 'identifier' &&
                  rhs.text === paramNames[i]!
                );
              });
            if (matches) {
              findings.push({
                id: `dc-${ctx.relPath}-${node.startPosition.row}-${counter++}`,
                file: ctx.relPath,
                line: node.startPosition.row + 1,
                transformId: 'class_to_dataclass',
                remediationMinutes: REMEDIATION,
                confidence: 'high',
              });
            }
          }
        }
      }
    }
    for (const c of node.namedChildren) visit(c);
  }
  visit(ctx.tree.rootNode);
  return findings;
}

register({ transformId: 'class_to_dataclass', lang: 'python', detect });
