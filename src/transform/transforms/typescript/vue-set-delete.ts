// src/transform/transforms/typescript/vue-set-delete.ts
//
// Rewrites Vue 2 reactivity helpers to plain JavaScript assignment / delete:
//
//   Vue.set(obj, key, value)      → obj[key] = value     (or obj.key in ident form)
//   Vue.delete(obj, key)          → delete obj[key]      (or delete obj.key)
//   this.$set(obj, key, value)    → obj[key] = value
//   this.$delete(obj, key)        → delete obj[key]
//
// File-scope:
//   - .js / .ts only. `.vue` SFCs are REFUSED with `vue_sfc_not_supported` —
//     SFC support requires a Single-File-Component parser and is deferred to
//     v0.4. Marked at the top so the deferral is explicit on review.
//
// Refusals:
//   - vue_sfc_not_supported       : .vue file (out of scope for v0.2.3).
//   - wrong_arity                 : set wants 3 args, delete wants 2.
//   - delete_in_expression_context: `Vue.delete` returns `undefined`; a bare
//                                    `delete obj.k` expression returns a
//                                    boolean — DIFFERENT runtime values, so
//                                    we refuse rather than silently change
//                                    semantics. (`Vue.set` is safe because
//                                    `obj.k = v` evaluates to `v`, which is
//                                    what `Vue.set` returns.)
//
// Vue 2 / Vue 3 reactivity caveat:
//   Vue 2's `Object.defineProperty`-based reactivity REQUIRES `Vue.set` to add
//   NEW reactive keys; direct assignment is not reactive in that case. Vue 3
//   (Proxy-based) makes direct assignment reactive, so the rewrite is
//   semantically equivalent. We can't reliably detect the Vue major version at
//   static-analysis time without resolving the project's installed dep, so
//   v0.2.3 assumes Vue 3 and asks the user to `--exclude
//   vue_set_delete_to_assignment` on Vue 2 projects. This caveat ships to the
//   user via the suggestion text in
//   `src/cli/v2-adapters.ts` (`SUGGESTION_BY_TRANSFORM`), NOT via a
//   precondition: the locked `Precondition` contract is binary
//   (satisfied/unsatisfied) with no informational severity, so encoding a
//   caveat as `satisfied: true` would misuse the shape. A `vueMajorVersion`
//   config key (analogous to `pythonVersion`) is a v0.4 follow-up if user
//   pull emerges.
//
// Key-form selection (string-literal key):
//   - Valid JS identifier AND not a reserved word ⇒ dot notation (`obj.foo`).
//   - Anything else (spaces, digits-first, reserved words) ⇒ bracket
//     notation (`obj["foo bar"]`, `obj["class"]`). This matches the form a
//     human would type and avoids generating illegal `obj.class` lookups.

import { Node, SyntaxKind, type CallExpression, type SourceFile } from 'ts-morph';
import type { TransformContext, TransformResult, TransformImpl } from '../../types.js';
import { withProject, type TsPrecondition } from './_shared.js';

/** Reserved words that cannot follow a `.` (ES standard reserved set, plus the
 *  contextual keywords commonly disallowed in member-access position by older
 *  engines / linters). Conservative — if in doubt, fall back to bracket form. */
const RESERVED_WORDS = new Set([
  'if',
  'for',
  'class',
  'return',
  'function',
  'const',
  'let',
  'var',
  'new',
  'delete',
  'typeof',
  'instanceof',
  'in',
  'of',
  'do',
  'while',
  'switch',
  'case',
  'default',
  'break',
  'continue',
  'throw',
  'try',
  'catch',
  'finally',
  'void',
  'null',
  'true',
  'false',
  'this',
  'super',
  'import',
  'export',
  'from',
  'as',
  'await',
  'async',
  'yield',
  'static',
  'extends',
  'enum',
  'debugger',
  'with',
  // TypeScript strict-mode reserved words. These are syntactically legal as
  // member-access names in plain JS, but rejected by strict-mode parsers and
  // by TypeScript when used as identifiers — so we keep them in bracket form
  // to stay safe across `.ts` and strict-mode `.js` callers.
  'implements',
  'interface',
  'package',
  'private',
  'protected',
  'public',
]);

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Recognise the four call shapes:
 *   - Vue.set / Vue.delete       — callee is Identifier("Vue") . Identifier(name)
 *   - this.$set / this.$delete   — callee is ThisExpression . Identifier($name)
 */
type VueOp = 'set' | 'delete';

function classifyCall(call: CallExpression): VueOp | null {
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return null;
  const propName = callee.getName();
  const recv = callee.getExpression();

  // Vue.set / Vue.delete
  if (Node.isIdentifier(recv) && recv.getText() === 'Vue') {
    if (propName === 'set') return 'set';
    if (propName === 'delete') return 'delete';
    return null;
  }

  // this.$set / this.$delete
  if (recv.getKind() === SyntaxKind.ThisKeyword) {
    if (propName === '$set') return 'set';
    if (propName === '$delete') return 'delete';
    return null;
  }

  return null;
}

/** Build the `<receiver>.<key>` or `<receiver>[<keyExpr>]` access prefix. */
function buildAccess(receiverText: string, keyArg: Node): string {
  if (Node.isStringLiteral(keyArg) || Node.isNoSubstitutionTemplateLiteral(keyArg)) {
    const value = keyArg.getLiteralText();
    if (IDENT_RE.test(value) && !RESERVED_WORDS.has(value)) {
      return `${receiverText}.${value}`;
    }
    // Preserve the original quoted form (with its quote style).
    return `${receiverText}[${keyArg.getText()}]`;
  }
  // Identifiers, numeric literals, computed expressions — bracket form.
  return `${receiverText}[${keyArg.getText()}]`;
}

/** True when this CallExpression is the entire body of an ExpressionStatement —
 *  i.e. its return value is not consumed. */
function isStatementContext(call: CallExpression): boolean {
  const parent = call.getParent();
  return !!parent && Node.isExpressionStatement(parent);
}

export async function transform(ctx: TransformContext): Promise<TransformResult> {
  // .vue SFCs are out of scope for v0.2.3 — they need a Single-File-Component
  // parser. Refuse loudly so a reviewer running the transform against a Vue
  // project sees an explicit reason rather than a silent no-op.
  if (ctx.absPath.endsWith('.vue')) {
    return {
      newContent: null,
      preconditions: [
        {
          id: 'vue_sfc_not_supported',
          satisfied: false,
          reason:
            '.vue SFCs require a Single-File-Component parser; out of scope for v0.2.3 (deferred to v0.4)',
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
      const op = classifyCall(call);
      if (op === null) continue;

      const args = call.getArguments();
      const wantArity = op === 'set' ? 3 : 2;
      if (args.length !== wantArity) {
        preconditions.push({
          id: 'wrong_arity',
          satisfied: false,
          reason: `${op === 'set' ? 'Vue.set/this.$set' : 'Vue.delete/this.$delete'} expects ${wantArity} arguments, got ${args.length}`,
        });
        continue;
      }

      const objArg = args[0]!;
      const keyArg = args[1]!;
      const valueArg = op === 'set' ? args[2]! : null;

      // `delete obj.k` returns a boolean; `Vue.delete(...)` returns undefined.
      // The values differ, so any non-statement use is a semantic change —
      // refuse rather than silently rewrite.
      if (op === 'delete' && !isStatementContext(call)) {
        preconditions.push({
          id: 'delete_in_expression_context',
          satisfied: false,
          reason:
            'Vue.delete returns undefined; `delete obj[k]` returns boolean — refusing to rewrite in expression position',
        });
        continue;
      }

      const access = buildAccess(objArg.getText(), keyArg);

      let text: string;
      if (op === 'set') {
        const valueText = valueArg!.getText();
        if (isStatementContext(call)) {
          // `Vue.set(obj, k, v);` → `obj.k = v;`
          text = `${access} = ${valueText}`;
        } else {
          // Expression context: `const x = Vue.set(...)` → `const x = (obj.k = v)`.
          // Parens make precedence explicit; an assignment expression has the
          // lowest binary precedence, so without them we'd hit binding issues
          // in most parents (e.g. binary operators, function-call arguments).
          text = `(${access} = ${valueText})`;
        }
      } else {
        // delete is statement-only here (we refused expression context above).
        text = `delete ${access}`;
      }

      replacements.push({ call, text });
    }

    if (replacements.length === 0) {
      return { changed: false, preconditions };
    }

    // Apply in reverse source order so earlier rewrites don't invalidate
    // later positions.
    replacements.sort((a, b) => b.call.getStart() - a.call.getStart());
    for (const r of replacements) {
      r.call.replaceWithText(r.text);
    }

    // NOTE: the Vue 2 / Vue 3 reactivity caveat is intentionally NOT emitted
    // as a precondition — see top-of-file comment. It ships via the
    // suggestion text in `src/cli/v2-adapters.ts`.
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
  id: 'vue_set_delete_to_assignment',
  lang: 'typescript',
  apply: transform,
};
