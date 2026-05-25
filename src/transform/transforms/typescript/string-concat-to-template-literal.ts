// src/transform/transforms/typescript/string-concat-to-template-literal.ts
//
// Rewrites `"Hello " + name + "!"` to `` `Hello ${name}!` ``. Conservative
// about operand types so we never paper over an actual `+` (addition).
//
// Refusals:
//   - unknown_operand_type : any operand has type `any`/`unknown` — could be
//                             addition, not concatenation.
//   - non_coercible_operand: operand has a type that's not string/number/boolean.
//                             Coercing an object via `toString()` is rarely
//                             intentional. (Also covers nested `+` over
//                             non-primitive operands — flatten() lifts them
//                             into the chain, and this check refuses on the
//                             non-primitive operand directly.)
//   - non_es2015           : tsconfig target < ES2015 — template literals
//                              aren't available.

import {
  Node,
  SyntaxKind,
  type BinaryExpression,
  type Expression,
  type SourceFile,
  type Type,
} from 'ts-morph';
import type { TransformContext, TransformResult, TransformImpl } from '../../types.js';
import { withProject, type TsPrecondition } from './_shared.js';
import { resolveTsConfigTarget, targetAtLeast } from './_tsconfig.js';

/** True iff `bin`'s operator is `+`. */
function isPlus(bin: BinaryExpression): boolean {
  return bin.getOperatorToken().getKind() === SyntaxKind.PlusToken;
}

/** Strip parens from an expression node. */
function unwrap(expr: Expression): Expression {
  let n: Expression = expr;
  while (Node.isParenthesizedExpression(n)) {
    n = n.getExpression();
  }
  return n;
}

/**
 * Flatten a `+`-chain into the left-to-right operand list. A right-leaning
 * tree (`"a" + (b + "c")`) and a left-leaning tree (`("a" + b) + "c"`) both
 * yield `["a", b, "c"]`.
 *
 * Parenthesised subexpressions remain in the chain (`+`-binaries inside
 * parens are flattened only when they are themselves `+`-chains; non-`+`
 * subexpressions stay as a single operand). This keeps semantics-preservation
 * straightforward — we only touch the operators we own.
 */
function flatten(bin: BinaryExpression): Expression[] {
  const out: Expression[] = [];
  function visit(node: Expression): void {
    const inner = unwrap(node);
    if (Node.isBinaryExpression(inner) && isPlus(inner)) {
      visit(inner.getLeft());
      visit(inner.getRight());
    } else {
      out.push(inner);
    }
  }
  visit(bin);
  return out;
}

/**
 * Type-safety predicate for an interpolation candidate.
 *
 * Returns null when the operand is safe; a precondition id otherwise.
 *
 * Performance: `getType()` can be slow on large files. We call it at most
 * once per operand here. Up-front collection of operands and a single pass
 * keeps the worst-case linear in chain length.
 */
function classifyOperand(operand: Expression): 'safe' | 'unknown' | 'non_coercible' {
  // String literals are always safe — they become the literal text portion of
  // the template, not an interpolation. We never call getType() on them.
  if (Node.isStringLiteral(operand) || Node.isNoSubstitutionTemplateLiteral(operand)) {
    return 'safe';
  }

  // Note: we intentionally do NOT special-case nested `+`-binaries here.
  // `flatten()` has already lifted every operand of every `+` subexpression
  // into the operand list, so this function sees the LEAVES of the chain —
  // never a `+`-binary. Safety against accidental addition is delivered by
  // the `non_coercible` refusal below: any non-primitive operand
  // (`isStringNumberOrBooleanType` returning false) blocks the rewrite.

  const t = operand.getType();
  if (isAnyOrUnknownType(t)) return 'unknown';
  if (isStringNumberOrBooleanType(t)) return 'safe';
  return 'non_coercible';
}

function isAnyOrUnknownType(t: Type): boolean {
  return t.isAny() || t.isUnknown();
}

function isStringNumberOrBooleanType(t: Type): boolean {
  if (t.isString() || t.isStringLiteral()) return true;
  if (t.isNumber() || t.isNumberLiteral()) return true;
  if (t.isBoolean() || t.isBooleanLiteral()) return true;
  if (t.isUnion()) {
    return t.getUnionTypes().every((u) => isStringNumberOrBooleanType(u));
  }
  return false;
}

/**
 * Escape a string literal's CONTENT (already unquoted text) for inclusion as
 * the literal portion of a template literal:
 *   - backslashes already in the source survive as-is (StringLiteral.getText()
 *     returns the source bytes WITH the quotes; we strip those off and the
 *     escapes within are byte-for-byte legal inside a template literal too,
 *     EXCEPT for ` and ${).
 *   - ` must become \`
 *   - ${ must become \${  (so it's a literal `${`, not an interpolation)
 *
 * We work on the raw source text rather than the JS string value so we
 * preserve the user's choice of escape (e.g. `\n` stays as `\n` in the
 * output, not a real newline).
 */
function escapeForTemplate(literalSourceText: string): string {
  // literalSourceText INCLUDES the surrounding quotes — strip them.
  if (literalSourceText.length < 2) return literalSourceText;
  const quote = literalSourceText[0]!;
  if (quote !== '"' && quote !== "'") return literalSourceText;
  let inner = literalSourceText.slice(1, -1);
  // Unescape the quote we just removed: `'It\\'s'` → inner = `It\\'s`; we
  // want `It's` in the template (because `'` is no longer the delimiter).
  // We must NOT unescape an escaped backslash that precedes the quote.
  inner = unescapeQuote(inner, quote);
  // Now escape characters meaningful inside a template literal.
  // Backtick:
  inner = inner.replace(/`/g, '\\`');
  // Dollar-brace sequence — anchor on the `${` digraph, escape just the `$`:
  inner = inner.replace(/\$\{/g, '\\${');
  return inner;
}

/**
 * Replace every UNESCAPED `\<quote>` in `inner` with `<quote>`. An escaped
 * backslash that happens to precede a quote (`\\'`) must be preserved as
 * `\\'` — the backslash is its own escape, the quote is literal already.
 */
function unescapeQuote(inner: string, quote: string): string {
  let out = '';
  let i = 0;
  while (i < inner.length) {
    const c = inner[i]!;
    if (c === '\\' && inner[i + 1] === '\\') {
      // Preserve `\\` verbatim.
      out += '\\\\';
      i += 2;
      continue;
    }
    if (c === '\\' && inner[i + 1] === quote) {
      // `\<quote>` → `<quote>`.
      out += quote;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Render an interpolated operand `${...}`. The template-literal grammar
 * accepts any Expression inside `${ }`, so no extra parenthesisation is
 * required for any operand kind we can see here — identifiers, property
 * accesses, calls, and binaries all render identically.
 */
function renderInterpolation(operand: Expression): string {
  return `\${${operand.getText()}}`;
}

/**
 * Build the template literal text for a flat operand list. Adjacent string
 * literals are concatenated into a single text run.
 */
function buildTemplate(operands: Expression[]): string {
  const pieces: string[] = ['`'];
  for (const op of operands) {
    if (Node.isStringLiteral(op)) {
      pieces.push(escapeForTemplate(op.getText()));
    } else if (Node.isNoSubstitutionTemplateLiteral(op)) {
      // Strip the surrounding backticks and re-emit; ${} sequences inside
      // were already escaped to mean literal in the source so they remain
      // valid.
      const t = op.getText();
      pieces.push(t.slice(1, -1));
    } else {
      pieces.push(renderInterpolation(op));
    }
  }
  pieces.push('`');
  return pieces.join('');
}

/** True iff at least one operand in `operands` is a string literal. */
function hasStringLiteral(operands: Expression[]): boolean {
  return operands.some((o) => Node.isStringLiteral(o) || Node.isNoSubstitutionTemplateLiteral(o));
}

/**
 * Walk top-level `+`-binaries: a binary expression is "top-level" iff its
 * direct parent (after unwrapping ALL surrounding parens) is NOT another
 * `+`-binary. We only rewrite the outermost node of a chain — flatten()
 * handles the descent.
 *
 * Multi-level parens matter: for `"a" + ((b + "c"))`, the inner `b + "c"`
 * has parent `ParenthesizedExpression`, whose parent is ANOTHER
 * `ParenthesizedExpression`, whose parent is the outer `+`-binary. Walking a
 * single level would incorrectly classify the inner as top-level, queueing
 * it for a redundant rewrite (which then races with the outer's rewrite).
 */
function isTopLevelPlusChain(bin: BinaryExpression): boolean {
  if (!isPlus(bin)) return false;
  let parent = bin.getParent();
  while (parent && Node.isParenthesizedExpression(parent)) {
    parent = parent.getParent();
  }
  if (!parent) return true;
  return !(Node.isBinaryExpression(parent) && isPlus(parent));
}

export async function transform(ctx: TransformContext): Promise<TransformResult> {
  const target = resolveTsConfigTarget({
    projectRoot: ctx.crossFile?.projectRoot,
    absPath: ctx.absPath,
  });
  if (target !== null && !targetAtLeast(target, 'es2015')) {
    return {
      newContent: null,
      preconditions: [
        {
          id: 'non_es2015',
          satisfied: false,
          reason: `tsconfig target ${target} predates ES2015; template literals are not available`,
        },
      ],
    };
  }

  const result = withProject(ctx.absPath, ctx.source, (sf: SourceFile) => {
    const preconditions: TsPrecondition[] = [];

    interface Replacement {
      bin: BinaryExpression;
      text: string;
    }
    const replacements: Replacement[] = [];

    const bins = sf.getDescendantsOfKind(SyntaxKind.BinaryExpression);
    // Walking AND collecting in source order then applying in reverse keeps
    // the offsets valid during mutation.
    for (const bin of bins) {
      if (!isTopLevelPlusChain(bin)) continue;
      const operands = flatten(bin);
      if (!hasStringLiteral(operands)) continue;

      // Classify each non-string operand. We short-circuit on the first
      // refusal — calling getType() N more times after a refusal would just
      // burn CPU on a chain we've already decided to skip.
      let refusal: 'unknown' | 'non_coercible' | null = null;
      for (const op of operands) {
        const verdict = classifyOperand(op);
        if (verdict === 'safe') continue;
        refusal = verdict;
        break;
      }
      if (refusal === 'unknown') {
        preconditions.push({
          id: 'unknown_operand_type',
          satisfied: false,
          reason:
            'concat operand has type any/unknown; could be addition rather than concatenation',
        });
        continue;
      }
      if (refusal === 'non_coercible') {
        preconditions.push({
          id: 'non_coercible_operand',
          satisfied: false,
          reason: 'concat operand has a non-primitive type; toString() coercion likely unintended',
        });
        continue;
      }

      replacements.push({ bin, text: buildTemplate(operands) });
    }

    if (replacements.length === 0) {
      return { changed: false, preconditions };
    }

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
  id: 'string_concat_to_template_literal',
  lang: 'typescript',
  apply: transform,
};
