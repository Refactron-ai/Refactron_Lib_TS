// src/analyze/detectors/python/manual-typecheck.ts
import type { SyntaxNode } from 'tree-sitter';
import type { DetectorContext, DetectorFinding } from '../types.js';
import { register } from '../index.js';

const REMEDIATION = 5;

function isIsinstanceCall(node: SyntaxNode): boolean {
  if (node.type !== 'call') return false;
  const fn = node.childForFieldName('function');
  return fn?.type === 'identifier' && fn.text === 'isinstance';
}

export function detect(ctx: DetectorContext): DetectorFinding[] {
  const findings: DetectorFinding[] = [];
  let counter = 0;

  function visit(node: SyntaxNode): void {
    if (node.type === 'function_definition') {
      const body = node.childForFieldName('body');
      if (body) {
        let chainBranches = 0;
        for (const stmt of body.namedChildren) {
          if (stmt.type !== 'if_statement') continue;
          let walker: SyntaxNode | null = stmt;
          while (walker) {
            const cond = walker.childForFieldName('condition');
            if (cond && isIsinstanceCall(cond)) chainBranches++;
            const alt: SyntaxNode | null = walker.childForFieldName('alternative');
            walker = alt && alt.type === 'elif_clause' ? alt : null;
          }
        }
        if (chainBranches >= 2) {
          findings.push({
            id: `tc-${ctx.relPath}-${node.startPosition.row}-${counter++}`,
            file: ctx.relPath,
            line: node.startPosition.row + 1,
            transformId: 'manual_typecheck_to_hints',
            remediationMinutes: REMEDIATION,
            confidence: 'medium',
          });
        }
      }
    }
    for (const c of node.namedChildren) visit(c);
  }
  visit(ctx.tree.rootNode);
  return findings;
}

register({ transformId: 'manual_typecheck_to_hints', lang: 'python', detect });
