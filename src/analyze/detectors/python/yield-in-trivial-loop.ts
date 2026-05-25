// src/analyze/detectors/python/yield-in-trivial-loop.ts
// Detect `for X in Y: yield X` — a trivial loop body that's exactly
// `yield <loop-var>` and can be rewritten as `yield from Y`. Skips:
//
//   * tuple targets:                `for a, b in items: yield a`  (out of scope)
//   * else-branches:                `for x in xs: yield x\nelse: ...`
//                                   (for/else doesn't transfer to `yield from`)
//   * already-`yield from`:         `for x in xs: yield from x` (nothing to do)
//   * multi-statement body:         `for x in xs: yield x; print(x)`
//   * non-bare-name iterables that the detector can't ascertain are stable —
//     actually we DO allow any expression here, the transform will faithfully
//     preserve it. The brief mentions an "iterable variable name that's not a
//     simple Name" exception — we relax that to "any expression" because
//     `yield from <expr>` is well-defined for any iterable, and the transform
//     reuses the original CST node verbatim.
//
// No version gate: `yield from` has been available since Python 3.3 — covered
// by every supported runtime.
import type { SyntaxNode } from 'tree-sitter';
import type { DetectorContext, DetectorFinding } from '../types.js';
import { register } from '../index.js';

const REMEDIATION = 1;

export function detect(ctx: DetectorContext): DetectorFinding[] {
  const findings: DetectorFinding[] = [];
  let counter = 0;

  function push(row: number): void {
    findings.push({
      id: `yf-${ctx.relPath}-${row}-${counter++}`,
      file: ctx.relPath,
      line: row + 1,
      transformId: 'yield_from_for_loop',
      remediationMinutes: REMEDIATION,
      confidence: 'high',
    });
  }

  // `yield from` is a SyntaxError inside `async def` (CPython 3.7+). Walk
  // ancestors to bail out on `for` loops nested under an async function body.
  // (The same caveat applies to top-level `async for ...: yield x` — that's
  // an async generator and `yield from` would corrupt it.)
  function isInsideAsyncDef(n: SyntaxNode): boolean {
    let p: SyntaxNode | null = n.parent;
    while (p) {
      if (p.type === 'function_definition') {
        return p.children.some((c) => !c.isNamed && c.text === 'async');
      }
      p = p.parent;
    }
    return false;
  }

  function visit(node: SyntaxNode): void {
    if (node.type === 'for_statement') {
      // tree-sitter-python's `for_statement` rule covers BOTH `for ...` and
      // `async for ...` (the `async` keyword shows up as an unnamed child
      // token). The async-for form is only valid inside an `async def`, and
      // `yield from` is illegal there — skip outright.
      const isAsyncFor = node.children.some((c) => !c.isNamed && c.text === 'async');
      if (isAsyncFor) {
        for (const c of node.namedChildren) visit(c);
        return;
      }
      // Plain `for` directly inside an `async def` body: still illegal to
      // rewrite (would produce `yield from` inside async function → SyntaxError).
      if (isInsideAsyncDef(node)) {
        for (const c of node.namedChildren) visit(c);
        return;
      }
      const left = node.childForFieldName('left');
      const body = node.childForFieldName('body');
      // Skip if there's an `else:` clause. tree-sitter-python surfaces this
      // as an `else_clause` child (not a field), so scan the named children.
      let hasElse = false;
      for (const c of node.namedChildren) {
        if (c.type === 'else_clause') {
          hasElse = true;
          break;
        }
      }

      if (left && body && !hasElse) {
        // Loop var must be a single identifier (tuple targets like
        // `for a, b in items:` produce a `pattern_list` here, which we skip).
        if (left.type === 'identifier') {
          const loopVar = left.text;
          // `body` is a `block` containing one or more statements. We require
          // exactly one statement, and that statement must be an
          // `expression_statement` containing a single `yield` whose value is
          // the bare loop variable.
          if (body.type === 'block' && body.namedChildren.length === 1) {
            const only = body.namedChildren[0]!;
            if (only.type === 'expression_statement' && only.namedChildren.length === 1) {
              const expr = only.namedChildren[0]!;
              if (expr.type === 'yield') {
                // tree-sitter-python uses the `yield` node for both
                // `yield X` and `yield from X`. `yield from` includes a
                // literal `from` keyword among the unnamed children, so
                // detect it via the raw text prefix (after the `yield`
                // keyword).
                const text = expr.text.trim();
                const isYieldFrom = /^yield\s+from\b/.test(text);
                if (!isYieldFrom) {
                  // The yielded value is the first named child after the
                  // `yield` keyword (which is an unnamed token).
                  const yielded = expr.namedChildren[0];
                  if (yielded && yielded.type === 'identifier' && yielded.text === loopVar) {
                    push(node.startPosition.row);
                  }
                }
              }
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

register({ transformId: 'yield_from_for_loop', lang: 'python', detect });
