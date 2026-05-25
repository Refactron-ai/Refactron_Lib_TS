// src/transform/transforms/typescript/indexof-to-includes.ts
//
// Rewrites the "contains" idiom built on `Array.prototype.indexOf` /
// `String.prototype.indexOf` to `.includes(...)`. Only the boolean-equivalent
// forms qualify:
//
//   arr.indexOf(x) !== -1   →   arr.includes(x)
//   arr.indexOf(x) >= 0     →   arr.includes(x)
//   arr.indexOf(x) > -1     →   arr.includes(x)
//   arr.indexOf(x) === -1   →   !arr.includes(x)
//   arr.indexOf(x) < 0      →   !arr.includes(x)
//   (-1 !== arr.indexOf(x), 0 <= arr.indexOf(x), -1 < arr.indexOf(x),
//    -1 === arr.indexOf(x), 0 > arr.indexOf(x)  — same five, LHS/RHS flipped)
//
// Position comparisons (`> 5`, `=== 3`, etc.) MUST NOT be rewritten because
// `.includes` returns a boolean — the position information is lost.
//
// Safety: only rewrite when the receiver type is provably string OR array.
// Anything else (DOM NodeList, jQuery, custom classes) gets refused with
// `non_callable_indexof` — `.includes` is not guaranteed to exist on those.

import {
  Node,
  SyntaxKind,
  type BinaryExpression,
  type CallExpression,
  type Expression,
  type SourceFile,
} from 'ts-morph';
import type { TransformContext, TransformResult, TransformImpl } from '../../types.js';
import { withProject, type TsPrecondition } from './_shared.js';
import { resolveTsConfigTarget, targetAtLeast } from './_tsconfig.js';

/** Which side of the binary expression is `arr.indexOf(x)` on? */
type IndexOfSide = 'left' | 'right';

interface Match {
  call: CallExpression;
  /** The literal on the OTHER side: `-1` or `0`. */
  literal: -1 | 0;
  side: IndexOfSide;
  operator: string;
  /** True ⇒ the comparison is the negative ("not contains") form: !includes. */
  negative: boolean;
}

/** Recognise integer literals -1 / 0 — including parenthesised and prefix-`-`. */
function readIntLiteral(expr: Expression): number | null {
  let node: Node = expr;
  // Unwrap parens.
  while (Node.isParenthesizedExpression(node)) {
    node = node.getExpression();
  }
  if (Node.isPrefixUnaryExpression(node)) {
    const op = node.getOperatorToken();
    const operand = node.getOperand();
    if (op === SyntaxKind.MinusToken && Node.isNumericLiteral(operand)) {
      const v = Number(operand.getText());
      return Number.isFinite(v) ? -v : null;
    }
    return null;
  }
  if (Node.isNumericLiteral(node)) {
    const v = Number(node.getText());
    return Number.isFinite(v) ? v : null;
  }
  return null;
}

/** True iff `expr` is a `something.indexOf(arg)` call expression. */
function asIndexOfCall(expr: Expression): CallExpression | null {
  let node: Expression = expr;
  while (Node.isParenthesizedExpression(node)) {
    node = node.getExpression();
  }
  if (!Node.isCallExpression(node)) return null;
  if (node.getArguments().length !== 1) return null;
  const callee = node.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return null;
  if (callee.getName() !== 'indexOf') return null;
  return node;
}

/**
 * Classify a `BinaryExpression` as one of the recognised contains/!contains
 * idioms. Returns null when the shape doesn't qualify (position comparison,
 * wrong operator, no indexOf call, etc.).
 */
function classify(bin: BinaryExpression): Match | null {
  const op = bin.getOperatorToken().getText();
  const left = bin.getLeft();
  const right = bin.getRight();

  const leftCall = asIndexOfCall(left);
  const rightCall = asIndexOfCall(right);
  // Exactly one side must be an indexOf call (mirrored shapes both qualify;
  // `a.indexOf(x) !== b.indexOf(y)` does not).
  if (leftCall && rightCall) return null;
  if (!leftCall && !rightCall) return null;

  const call = (leftCall ?? rightCall)!;
  const side: IndexOfSide = leftCall ? 'left' : 'right';
  const literalExpr = leftCall ? right : left;
  const lit = readIntLiteral(literalExpr);
  if (lit === null) return null;

  // The recognised contains/!contains forms. Pattern matching with the LHS
  // canonicalised to be the `indexOf` call:
  //
  //   indexOf !== -1  →  contains
  //   indexOf >= 0    →  contains
  //   indexOf > -1    →  contains
  //   indexOf === -1  →  !contains
  //   indexOf < 0     →  !contains
  //
  // For `side === 'right'` we mirror the operator: `a < b` ↔ `b > a`, etc.
  const canonicalOp = side === 'left' ? op : mirror(op);

  if (canonicalOp === '!==' && lit === -1) {
    return { call, literal: -1, side, operator: op, negative: false };
  }
  if (canonicalOp === '!=' && lit === -1) {
    return { call, literal: -1, side, operator: op, negative: false };
  }
  if (canonicalOp === '>=' && lit === 0) {
    return { call, literal: 0, side, operator: op, negative: false };
  }
  if (canonicalOp === '>' && lit === -1) {
    return { call, literal: -1, side, operator: op, negative: false };
  }
  if (canonicalOp === '===' && lit === -1) {
    return { call, literal: -1, side, operator: op, negative: true };
  }
  if (canonicalOp === '==' && lit === -1) {
    return { call, literal: -1, side, operator: op, negative: true };
  }
  if (canonicalOp === '<' && lit === 0) {
    return { call, literal: 0, side, operator: op, negative: true };
  }
  return null;
}

/** Flip a comparison operator across its operands. */
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
    // Equality operators are symmetric.
    default:
      return op;
  }
}

/**
 * Decide whether the receiver of the `indexOf` call has a type we can safely
 * convert. Only string OR array (incl. ReadonlyArray) is safe — anything
 * else may not have `.includes` (NodeList, jQuery, custom classes) or has
 * a different signature.
 *
 * For string LHS we additionally bail unless the matched form is one of the
 * five we declared safe — but `classify` only ever returns one of those, so
 * we don't need a second filter here.
 */
function isReceiverSafe(call: CallExpression): boolean {
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return false;
  const receiver = callee.getExpression();
  const t = receiver.getType();
  if (t.isString() || t.isStringLiteral()) return true;
  if (t.isArray() || t.isReadonlyArray()) return true;
  // `string | string[]` and friends: every constituent must be safe.
  if (t.isUnion()) {
    return t.getUnionTypes().every((u) => {
      return u.isString() || u.isStringLiteral() || u.isArray() || u.isReadonlyArray();
    });
  }
  return false;
}

/**
 * Build the replacement text for one match. Handles paren-wrapping of the
 * negative form so `!arr.includes(x) && ...` parses identically to the
 * original `arr.indexOf(x) === -1 && ...`.
 */
function buildReplacement(bin: BinaryExpression, match: Match): string {
  const callee = match.call.getExpression();
  // callee is the PropertyAccessExpression `recv.indexOf`. We rebuild as
  // `recv.includes(arg)` from the original token text so we preserve user
  // formatting (whitespace, comments inside the arg position would be a TODO
  // — ts-morph drops them when we re-serialise from AST, but the test plan
  // doesn't cover that surface).
  if (!Node.isPropertyAccessExpression(callee)) {
    // Defensive — classify() ensures we only get here for PropertyAccess.
    return bin.getText();
  }
  const receiverText = callee.getExpression().getText();
  const argText = match.call.getArguments()[0]!.getText();
  const includesCall = `${receiverText}.includes(${argText})`;
  if (!match.negative) {
    return includesCall;
  }
  // Negative form: `!recv.includes(arg)`. Paren-wrap when the parent context
  // demands it (i.e. anywhere the `!` would otherwise rebind a tighter
  // operator). The conservative rule: only skip parens when the parent
  // already provides them or is a top-level expression statement /
  // conditional that doesn't need them. We always emit just `!x.includes(y)`
  // because `!` has higher precedence than every binary operator the parent
  // could be — this matches the semantics of the original `=== -1` / `< 0`
  // which has comparison precedence. No outer parens needed in practice
  // because the original binary expression already sits in a position where
  // an expression of any precedence parses (a `!`-expression is a
  // UnaryExpression and binds tighter than every binary).
  return `!${includesCall}`;
}

export async function transform(ctx: TransformContext): Promise<TransformResult> {
  // Version gate: `Array.prototype.includes` and `String.prototype.includes`
  // were added in ES2016. Refuse on older targets so we don't introduce
  // runtime errors on legacy platforms.
  const target = resolveTsConfigTarget({
    projectRoot: ctx.crossFile?.projectRoot,
    absPath: ctx.absPath,
  });
  if (target !== null && !targetAtLeast(target, 'es2016')) {
    return {
      newContent: null,
      preconditions: [
        {
          id: 'non_es2016',
          satisfied: false,
          reason: `tsconfig target ${target} predates ES2016; .includes() is not available`,
        },
      ],
    };
  }

  const result = withProject(ctx.absPath, ctx.source, (sf: SourceFile) => {
    const preconditions: TsPrecondition[] = [];
    // Collect matches first so we don't mutate while iterating. Walking
    // BinaryExpression descendants then replacing parents-in-place would risk
    // re-visiting a rewritten range and double-applying.
    interface Replacement {
      bin: BinaryExpression;
      text: string;
    }
    const replacements: Replacement[] = [];

    const bins = sf.getDescendantsOfKind(SyntaxKind.BinaryExpression);
    for (const bin of bins) {
      // The same `arr.indexOf(x) !== -1` may appear as a sub-expression of a
      // larger BinaryExpression we've already processed. ts-morph's walk
      // visits ancestors before descendants, so child re-visits are bounded
      // and benign — `classify` only matches the inner shape once.
      const match = classify(bin);
      if (!match) continue;
      if (!isReceiverSafe(match.call)) {
        preconditions.push({
          id: 'non_callable_indexof',
          satisfied: false,
          reason: 'indexOf receiver is not a string or array; .includes() is not guaranteed',
        });
        continue;
      }
      replacements.push({ bin, text: buildReplacement(bin, match) });
    }

    if (replacements.length === 0) {
      return { changed: false, preconditions };
    }

    // Apply replacements in reverse source order: replacing a parent first
    // would invalidate every descendant offset.
    replacements.sort((a, b) => b.bin.getStart() - a.bin.getStart());
    for (const r of replacements) {
      r.bin.replaceWithText(r.text);
    }
    return { changed: true, preconditions };
  });

  return {
    newContent: result.newContent,
    preconditions: result.preconditions.map((p) =>
      p.reason !== undefined
        ? { id: p.id, satisfied: p.satisfied, reason: p.reason }
        : { id: p.id, satisfied: p.satisfied },
    ),
  };
}

export const impl: TransformImpl = {
  id: 'indexof_to_includes',
  lang: 'typescript',
  apply: transform,
};
