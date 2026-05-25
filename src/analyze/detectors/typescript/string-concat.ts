// src/analyze/detectors/typescript/string-concat.ts
//
// Flags `+`-binary expressions where any operand is a string literal. The
// `string_concat_to_template_literal` transform then decides — via ts-morph
// type info — whether the rewrite is safe.
//
// Confidence: `medium`. Without type info we can't tell if a non-literal
// operand is a string, number, object, etc. — the transform handles that
// with `getType()` checks.
//
// TODO(v0.4.0): consider promoting to `high` once we wire tree-sitter +
// query-driven type heuristics for the common identifier-of-string-literal
// case (`const greeting = "hi"; ... greeting + name`).

import type { SyntaxNode } from 'tree-sitter';
import type { DetectorContext, DetectorFinding } from '../types.js';
import { register } from '../index.js';

const REMEDIATION = 2;

/**
 * Walk into a `+`-binary's left/right and collect terminal operands. We stop
 * descending at any non-`+`-binary so a one-call walk yields the flat
 * operand list of the whole chain.
 */
function collectPlusOperands(node: SyntaxNode, out: SyntaxNode[]): void {
  if (node.type === 'binary_expression') {
    const op = node.childForFieldName('operator');
    if (op && op.text === '+') {
      const left = node.childForFieldName('left');
      const right = node.childForFieldName('right');
      if (left) collectPlusOperands(left, out);
      if (right) collectPlusOperands(right, out);
      return;
    }
  }
  if (node.type === 'parenthesized_expression') {
    const inner = node.namedChildren[0];
    if (inner) {
      collectPlusOperands(inner, out);
      return;
    }
  }
  out.push(node);
}

function isStringLiteral(node: SyntaxNode): boolean {
  return node.type === 'string' || node.type === 'template_string';
}

/** True iff this `+`-binary's PARENT is also a `+`-binary — i.e. we're an
 *  inner node of a chain and the outermost node will pick us up. */
function isInsidePlusChain(node: SyntaxNode): boolean {
  let parent = node.parent;
  while (parent && parent.type === 'parenthesized_expression') {
    parent = parent.parent;
  }
  if (!parent) return false;
  if (parent.type === 'binary_expression') {
    const op = parent.childForFieldName('operator');
    if (op && op.text === '+') return true;
  }
  return false;
}

export function detect(ctx: DetectorContext): DetectorFinding[] {
  const findings: DetectorFinding[] = [];
  let counter = 0;

  function visit(node: SyntaxNode): void {
    if (node.type === 'binary_expression') {
      const op = node.childForFieldName('operator');
      if (op && op.text === '+' && !isInsidePlusChain(node)) {
        const operands: SyntaxNode[] = [];
        collectPlusOperands(node, operands);
        if (operands.some(isStringLiteral)) {
          findings.push({
            id: `concat-${ctx.relPath}-${node.startPosition.row}-${counter++}`,
            file: ctx.relPath,
            line: node.startPosition.row + 1,
            transformId: 'string_concat_to_template_literal',
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

register({ transformId: 'string_concat_to_template_literal', lang: 'typescript', detect });
