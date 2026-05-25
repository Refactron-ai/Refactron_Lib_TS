// src/analyze/detectors/typescript/indexof-comparison.ts
//
// Flags the boolean-equivalent `arr.indexOf(x) <op> <lit>` patterns the
// `indexof_to_includes` transform rewrites. We match tree-sitter
// `binary_expression` nodes whose operator is one of the recognised ones AND
// whose operand pair is (`indexOf(...)` call, integer literal).
//
// Confidence: `high`. The receiver-type safety check ("is it a string or
// array?") lives in the transform — type info isn't available from
// tree-sitter alone, so the detector flags the syntactic shape and the
// transform decides whether to actually rewrite.
//
// Position-form patterns (`arr.indexOf(x) > 5`, `=== 3`, etc.) are NOT
// matched here: there's no safe rewrite to `.includes`.

import type { SyntaxNode } from 'tree-sitter';
import type { DetectorContext, DetectorFinding } from '../types.js';
import { register } from '../index.js';

const REMEDIATION = 1;

/** Read `-1`, `0`, `(0)`, `(-1)` as a number; return null otherwise. */
function readIntLiteral(node: SyntaxNode): number | null {
  let n: SyntaxNode = node;
  while (n.type === 'parenthesized_expression') {
    const inner = n.namedChildren[0];
    if (!inner) return null;
    n = inner;
  }
  if (n.type === 'number') {
    const v = Number(n.text);
    return Number.isFinite(v) ? v : null;
  }
  if (n.type === 'unary_expression') {
    // tree-sitter-typescript exposes the operator as the first child token.
    const opNode = n.children[0];
    const op = opNode ? opNode.text : '';
    const argNode = n.childForFieldName('argument') ?? n.namedChildren[0];
    if (op === '-' && argNode && argNode.type === 'number') {
      const v = Number(argNode.text);
      return Number.isFinite(v) ? -v : null;
    }
  }
  return null;
}

/** True iff `node` is a call expression `something.indexOf(x)` with one arg. */
function isIndexOfCall(node: SyntaxNode): boolean {
  let n: SyntaxNode = node;
  while (n.type === 'parenthesized_expression') {
    const inner = n.namedChildren[0];
    if (!inner) return false;
    n = inner;
  }
  if (n.type !== 'call_expression') return false;
  const fn = n.childForFieldName('function');
  if (!fn || fn.type !== 'member_expression') return false;
  const prop = fn.childForFieldName('property');
  if (!prop || prop.text !== 'indexOf') return false;
  const args = n.childForFieldName('arguments');
  // tree-sitter `arguments` includes punctuation; check named children for arity.
  if (!args) return false;
  const realArgs = args.namedChildren.filter((c) => c.type !== 'comment');
  return realArgs.length === 1;
}

/** Set of operators that participate in the recognised contains/!contains shapes. */
const REL_OPS = new Set(['!==', '!=', '===', '==', '<', '>', '<=', '>=']);

function isContainsShape(op: string, literalValue: number, indexOfSide: 'left' | 'right'): boolean {
  // Canonical form: indexOf on the LEFT, mirror operator when it's on right.
  const canonical = indexOfSide === 'left' ? op : mirror(op);
  if (canonical === '!==' && literalValue === -1) return true;
  if (canonical === '!=' && literalValue === -1) return true;
  if (canonical === '>=' && literalValue === 0) return true;
  if (canonical === '>' && literalValue === -1) return true;
  if (canonical === '===' && literalValue === -1) return true;
  if (canonical === '==' && literalValue === -1) return true;
  if (canonical === '<' && literalValue === 0) return true;
  return false;
}

function mirror(op: string): string {
  switch (op) {
    case '<':
      return '>';
    case '>':
      return '<';
    case '<=':
      return '>=';
    case '>=':
      return '<=';
    default:
      return op;
  }
}

export function detect(ctx: DetectorContext): DetectorFinding[] {
  const findings: DetectorFinding[] = [];
  let counter = 0;

  function visit(node: SyntaxNode): void {
    if (node.type === 'binary_expression') {
      const opNode = node.childForFieldName('operator');
      const left = node.childForFieldName('left');
      const right = node.childForFieldName('right');
      if (opNode && left && right) {
        const op = opNode.text;
        if (REL_OPS.has(op)) {
          let indexOfSide: 'left' | 'right' | null = null;
          let literal: number | null = null;
          if (isIndexOfCall(left)) {
            indexOfSide = 'left';
            literal = readIntLiteral(right);
          } else if (isIndexOfCall(right)) {
            indexOfSide = 'right';
            literal = readIntLiteral(left);
          }
          if (indexOfSide && literal !== null && isContainsShape(op, literal, indexOfSide)) {
            findings.push({
              id: `indexof-${ctx.relPath}-${node.startPosition.row}-${counter++}`,
              file: ctx.relPath,
              line: node.startPosition.row + 1,
              transformId: 'indexof_to_includes',
              remediationMinutes: REMEDIATION,
              confidence: 'high',
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

register({ transformId: 'indexof_to_includes', lang: 'typescript', detect });
