// src/transform/transforms/typescript/object-assign-to-spread.ts
//
// Rewrites `Object.assign({}, a, b, { x: 1 })` to a spread object literal
// `{ ...a, ...b, x: 1 }`. Only safe when the FIRST argument is an object
// literal — `Object.assign(target, ...)` with a mutable target has semantics
// (returning `target` itself, with new properties merged) that a spread does
// not preserve.
//
// Refusals:
//   - non_literal_target  : first arg is not an ObjectLiteralExpression
//   - spread_argument_present: any source uses `...iter` syntax (semantics differ
//                                 — `{...iter}` doesn't iterate)
//   - non_es2018          : tsconfig target < ES2018 (object spread is ES2018)

import {
  Node,
  SyntaxKind,
  type CallExpression,
  type ObjectLiteralExpression,
  type SourceFile,
} from 'ts-morph';
import type { TransformContext, TransformResult, TransformImpl } from '../../types.js';
import { withProject, type TsPrecondition } from './_shared.js';
import { resolveTsConfigTarget, targetAtLeast } from './_tsconfig.js';

/** Match `Object.assign(...)` exactly (not `MyObject.assign`, not `assign(...)`). */
function isObjectAssignCall(call: CallExpression): boolean {
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return false;
  if (callee.getName() !== 'assign') return false;
  const left = callee.getExpression();
  if (!Node.isIdentifier(left)) return false;
  return left.getText() === 'Object';
}

/**
 * Build the spread-object replacement text from a recognised
 * `Object.assign({}, a, b, { x: 1 })` call.
 *
 * Inlining strategy: each non-literal source becomes `...expr`. Each literal
 * source inlines its own properties directly — this matches what a human
 * would write and avoids `{ ...{x:1} }` redundancy. The first argument's
 * literal contributes its own properties at the start (before the rest).
 */
function buildReplacement(call: CallExpression): string | null {
  const args = call.getArguments();
  if (args.length === 0) return null;
  const first = args[0]!;
  if (!Node.isObjectLiteralExpression(first)) return null;

  const parts: string[] = [];

  // Properties from the first argument (if any).
  const firstProps = (first as ObjectLiteralExpression).getProperties();
  for (const p of firstProps) {
    parts.push(p.getText());
  }

  // Each subsequent argument:
  //   - object literal  → inline its properties
  //   - spread (...x)   → caller has already refused upstream
  //   - any other expr  → spread the expression
  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!;
    if (Node.isSpreadElement(arg)) return null;
    if (Node.isObjectLiteralExpression(arg)) {
      for (const p of arg.getProperties()) {
        parts.push(p.getText());
      }
    } else {
      parts.push(`...${arg.getText()}`);
    }
  }

  if (parts.length === 0) return '{}';
  return `{ ${parts.join(', ')} }`;
}

/**
 * Does the call sit in a position where an object-literal expression would
 * be parsed as a block? Currently the only context that matters:
 *
 *   `() => Object.assign({}, a)`  → arrow with expression body.
 *
 * Without parens, `() => { ...a }` parses as a block statement spreading into
 * nothing. Wrapping in parens disambiguates: `() => ({ ...a })`.
 *
 * Any other expression context already requires no parens because
 * `Object.assign(...)` returns an `unknown`-typed value and the parent never
 * sees `{` as the first token after a `=>`.
 */
function needsParens(call: CallExpression): boolean {
  const parent = call.getParent();
  if (!parent) return false;
  if (Node.isArrowFunction(parent)) {
    return parent.getBody() === call;
  }
  return false;
}

export async function transform(ctx: TransformContext): Promise<TransformResult> {
  const target = resolveTsConfigTarget({
    projectRoot: ctx.crossFile?.projectRoot,
    absPath: ctx.absPath,
  });
  if (target !== null && !targetAtLeast(target, 'es2018')) {
    return {
      newContent: null,
      preconditions: [
        {
          id: 'non_es2018',
          satisfied: false,
          reason: `tsconfig target ${target} predates ES2018; object spread is not available`,
        },
      ],
    };
  }

  const result = withProject(ctx.absPath, ctx.source, (sf: SourceFile) => {
    const preconditions: TsPrecondition[] = [];

    interface Replacement {
      call: CallExpression;
      text: string;
    }
    const replacements: Replacement[] = [];

    const calls = sf.getDescendantsOfKind(SyntaxKind.CallExpression);
    for (const call of calls) {
      if (!isObjectAssignCall(call)) continue;
      const args = call.getArguments();
      if (args.length === 0) continue;

      // Refuse spread-argument calls early — `{...sources}` is not equivalent
      // to `Object.assign({}, ...sources)` for an iterable of objects.
      const hasSpread = args.some((a) => Node.isSpreadElement(a));
      if (hasSpread) {
        preconditions.push({
          id: 'spread_argument_present',
          satisfied: false,
          reason: 'Object.assign with spread arguments has no 1:1 spread-literal rewrite',
        });
        continue;
      }

      const first = args[0]!;
      if (!Node.isObjectLiteralExpression(first)) {
        preconditions.push({
          id: 'non_literal_target',
          satisfied: false,
          reason: 'first argument is not an object literal; mutating semantics not preserved',
        });
        continue;
      }

      const literal = buildReplacement(call);
      if (literal === null) continue;
      const wrapped = needsParens(call) ? `(${literal})` : literal;
      replacements.push({ call, text: wrapped });
    }

    if (replacements.length === 0) {
      return { changed: false, preconditions };
    }

    replacements.sort((a, b) => b.call.getStart() - a.call.getStart());
    for (const r of replacements) {
      r.call.replaceWithText(r.text);
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
  id: 'object_assign_to_spread',
  lang: 'typescript',
  apply: transform,
};
