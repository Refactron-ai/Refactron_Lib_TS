// src/analyze/detectors/python/super-with-args.ts
// Detect `super(ClassName, self).method(...)` — the Python-2-style explicit
// super call that, since Python 3.0, can be the zero-arg `super().method(...)`.
//
// Conservative scope (v0.3.0):
//   - Only match `super(X, self).attr(...)` — the first positional must be a
//     Name (we don't try to resolve dotted class refs), the second must be
//     literally `self`. `cls` (classmethods) and other instance names are
//     out of scope until v0.4.
//   - We do NOT verify here that the Name matches the enclosing class — the
//     transform sidecar enforces that precondition. The detector just points
//     at the candidate site so the user can see it in `analyze`.
import type { SyntaxNode } from 'tree-sitter';
import type { DetectorContext, DetectorFinding } from '../types.js';
import { register } from '../index.js';

const REMEDIATION = 1;

export function detect(ctx: DetectorContext): DetectorFinding[] {
  const findings: DetectorFinding[] = [];
  let counter = 0;

  function push(row: number): void {
    findings.push({
      id: `super-args-${ctx.relPath}-${row}-${counter++}`,
      file: ctx.relPath,
      line: row + 1,
      transformId: 'super_no_args',
      remediationMinutes: REMEDIATION,
      confidence: 'high',
    });
  }

  function visit(node: SyntaxNode): void {
    // Pattern: <call>.<call-or-attr>
    //   outerCall.function = Attribute
    //     .object   = Call (the `super(X, self)` part)
    //     .attribute = Identifier (the method name — informational only)
    // We anchor on the inner super(...) call so a multi-line chain points
    // where the `super(...)` token actually is, not where the method call
    // happens to be invoked.
    if (node.type === 'call') {
      const fn = node.childForFieldName('function');
      if (fn && fn.type === 'identifier' && fn.text === 'super') {
        const args = node.childForFieldName('arguments');
        // tree-sitter-python `arguments` contains the parens; named children
        // are the argument expressions in order.
        const argExprs = args?.namedChildren ?? [];
        if (argExprs.length === 2) {
          const first = argExprs[0]!;
          const second = argExprs[1]!;
          if (
            first.type === 'identifier' &&
            second.type === 'identifier' &&
            second.text === 'self'
          ) {
            push(fn.startPosition.row);
          }
        }
      }
    }
    for (const c of node.namedChildren) visit(c);
  }

  visit(ctx.tree.rootNode);
  return findings;
}

register({ transformId: 'super_no_args', lang: 'python', detect });
