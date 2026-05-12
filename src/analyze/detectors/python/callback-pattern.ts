// src/analyze/detectors/python/callback-pattern.ts
import type { SyntaxNode } from 'tree-sitter';
import type { DetectorContext, DetectorFinding } from '../types.js';
import { register } from '../index.js';

const ALIASES = new Set(['callback', 'cb', 'done']);
const REMEDIATION = 7;

export function detect(ctx: DetectorContext): DetectorFinding[] {
  const findings: DetectorFinding[] = [];
  const root = ctx.tree.rootNode;
  let counter = 0;

  function visit(node: SyntaxNode): void {
    if (node.type === 'function_definition') {
      const paramsNode = node.childForFieldName('parameters');
      if (paramsNode) {
        const params = paramsNode.namedChildren.filter((p) => p.type === 'identifier');
        const last = params[params.length - 1];
        const name = last?.text;
        if (name && ALIASES.has(name)) {
          const body = node.childForFieldName('body');
          const calls: SyntaxNode[] = [];
          if (body) {
            const walk = (n: SyntaxNode): void => {
              if (n.type === 'call') {
                const fn = n.childForFieldName('function');
                if (fn && fn.type === 'identifier' && fn.text === name) calls.push(n);
              }
              for (const c of n.namedChildren) walk(c);
            };
            walk(body);
          }
          if (calls.length > 0) {
            const lastStmt = body?.namedChildren[body.namedChildren.length - 1];
            const lastCall = calls[calls.length - 1]!;
            const lastCallIsTrailing =
              !!lastStmt && (lastStmt === lastCall || lastStmt.namedChildren.includes(lastCall));
            findings.push({
              id: `cb-${ctx.relPath}-${node.startPosition.row}-${counter++}`,
              file: ctx.relPath,
              line: node.startPosition.row + 1,
              transformId: 'callback_to_async_await',
              remediationMinutes: REMEDIATION,
              confidence: lastCallIsTrailing ? 'high' : 'medium',
            });
          }
        }
      }
    }
    for (const c of node.namedChildren) visit(c);
  }
  visit(root);
  return findings;
}

register({
  transformId: 'callback_to_async_await',
  lang: 'python',
  detect,
});
