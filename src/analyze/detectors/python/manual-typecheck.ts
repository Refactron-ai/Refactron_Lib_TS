// src/analyze/detectors/python/manual-typecheck.ts
import type { SyntaxNode } from 'tree-sitter';
import type { DetectorContext, DetectorFinding } from '../types.js';
import { register } from '../index.js';

const REMEDIATION = 5;

/** If `node` is an `isinstance(<param>, <Type>)` call, return the discriminated
 *  parameter name; otherwise null. The transform only converts chains whose
 *  isinstance first argument is a plain name. */
function isinstanceParam(node: SyntaxNode): string | null {
  if (node.type !== 'call') return null;
  const fn = node.childForFieldName('function');
  if (fn?.type !== 'identifier' || fn.text !== 'isinstance') return null;
  const args = node.childForFieldName('arguments');
  const first = args?.namedChildren[0];
  return first && first.type === 'identifier' ? first.text : null;
}

/** Whether `paramName` carries a type annotation in `funcNode`'s signature.
 *  `manual_typecheck_to_hints` refuses to act on an already-annotated
 *  parameter (it would have nothing to add), so the detector must skip those
 *  too — otherwise it reports a "fix" the transform will never produce. */
function parameterIsAnnotated(funcNode: SyntaxNode, paramName: string): boolean {
  const params = funcNode.childForFieldName('parameters');
  if (!params) return false;
  for (const p of params.namedChildren) {
    // A bare `identifier` parameter has no annotation.
    if (p.type === 'identifier') {
      if (p.text === paramName) return false;
      continue;
    }
    // default_parameter / typed_parameter / typed_default_parameter: a `type`
    // child is present iff the parameter is annotated.
    const nameNode =
      p.childForFieldName('name') ?? p.namedChildren.find((c) => c.type === 'identifier') ?? null;
    if (nameNode?.text === paramName) {
      return p.childForFieldName('type') != null;
    }
  }
  return false;
}

export function detect(ctx: DetectorContext): DetectorFinding[] {
  const findings: DetectorFinding[] = [];
  let counter = 0;

  function visit(node: SyntaxNode): void {
    if (node.type === 'function_definition') {
      const body = node.childForFieldName('body');
      if (body) {
        const discriminated = new Set<string>();
        let chainBranches = 0;
        for (const stmt of body.namedChildren) {
          if (stmt.type !== 'if_statement') continue;
          let walker: SyntaxNode | null = stmt;
          while (walker) {
            const cond = walker.childForFieldName('condition');
            const param = cond ? isinstanceParam(cond) : null;
            if (param) {
              chainBranches++;
              discriminated.add(param);
            }
            const alt: SyntaxNode | null = walker.childForFieldName('alternative');
            walker = alt && alt.type === 'elif_clause' ? alt : null;
          }
        }
        // The transform converts an isinstance chain into a `Union[...]`
        // annotation, but ONLY when (a) the chain discriminates a single
        // parameter and (b) that parameter is not already annotated. Mirror
        // both conditions so every finding maps to a change the transform can
        // actually make — a looser detector inflates the "Fixable" count with
        // no-op findings.
        if (chainBranches >= 2 && discriminated.size === 1) {
          const param = [...discriminated][0]!;
          if (!parameterIsAnnotated(node, param)) {
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
    }
    for (const c of node.namedChildren) visit(c);
  }
  visit(ctx.tree.rootNode);
  return findings;
}

register({ transformId: 'manual_typecheck_to_hints', lang: 'python', detect });
