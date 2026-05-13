import { Node, type NewExpression, type SourceFile } from 'ts-morph';
import type { TransformContext, TransformResult, TransformImpl } from '../../types.js';
import { withProject, type TsPrecondition } from './_shared.js';

// Async escape hatches: if these appear inside the executor body, the promise's
// settlement is decoupled from synchronous control flow, so we cannot fold
// `new Promise((resolve) => resolve(x))` into a plain async return.
const ASYNC_HAZARD_RE = /\b(?:setTimeout|setInterval|addEventListener|setImmediate)\s*\(/;

// Captures the single-argument expression of `resolve(...)`. Non-greedy on the
// inner group; dotall via `s` so multi-line expressions are tolerated.
const RESOLVE_CALL_RE = /resolve\s*\(\s*([\s\S]+?)\s*\)/;
const RESOLVE_COUNT_RE = /\bresolve\s*\(/g;

type EnclosingFn = Node & {
  isAsync(): boolean;
  setIsAsync(value: boolean): unknown;
};

function isEnclosingFn(n: Node): n is EnclosingFn {
  return (
    Node.isFunctionDeclaration(n) ||
    Node.isFunctionExpression(n) ||
    Node.isArrowFunction(n) ||
    Node.isMethodDeclaration(n)
  );
}

function wasForgotten(n: Node): boolean {
  const maybe = n as unknown as { wasForgotten?: () => boolean };
  return typeof maybe.wasForgotten === 'function' ? maybe.wasForgotten() : false;
}

function findEnclosingFn(start: Node): EnclosingFn | undefined {
  let cur: Node | undefined = start.getParent();
  while (cur) {
    if (isEnclosingFn(cur)) return cur;
    cur = cur.getParent();
  }
  return undefined;
}

export async function transform(ctx: TransformContext): Promise<TransformResult> {
  const result = withProject(ctx.absPath, ctx.source, (sf: SourceFile) => {
    const preconditions: TsPrecondition[] = [];

    const newExprs = sf.getDescendants().filter((n): n is NewExpression => {
      return Node.isNewExpression(n) && n.getExpression().getText() === 'Promise';
    });

    let changed = false;

    for (const newExpr of newExprs) {
      // Earlier iterations may have replaced/forgotten this node.
      if (wasForgotten(newExpr)) continue;

      const args = newExpr.getArguments();
      if (args.length !== 1) continue;
      const executor = args[0];
      if (!executor) continue;
      if (!(Node.isArrowFunction(executor) || Node.isFunctionExpression(executor))) {
        continue;
      }

      const execText = executor.getText();

      if (ASYNC_HAZARD_RE.test(execText)) {
        preconditions.push({
          id: 'no-async-escape',
          satisfied: false,
          reason: 'executor body uses setTimeout/setInterval/addEventListener/setImmediate',
        });
        continue;
      }

      const resolveMatches = execText.match(RESOLVE_COUNT_RE) ?? [];
      if (resolveMatches.length !== 1) {
        preconditions.push({
          id: 'single-resolve',
          satisfied: false,
          reason: `executor body must contain exactly one resolve() call (found ${resolveMatches.length})`,
        });
        continue;
      }

      const resolveCall = execText.match(RESOLVE_CALL_RE);
      if (!resolveCall) continue;
      const value = resolveCall[1];
      if (value === undefined) continue;

      const fn = findEnclosingFn(newExpr);
      if (!fn) continue;
      if (wasForgotten(fn)) continue;
      if (fn.isAsync()) continue;

      const parent = newExpr.getParent();
      if (parent && Node.isReturnStatement(parent)) {
        if (wasForgotten(parent)) continue;
        parent.replaceWithText(`return ${value};`);
      } else {
        newExpr.replaceWithText(value);
      }

      // Re-check after the rewrite; replaceWithText may have forgotten `fn`
      // only if `fn` was an inner node of the replaced range, which cannot
      // happen here (fn always encloses newExpr/parent). Still guard.
      if (!wasForgotten(fn)) {
        fn.setIsAsync(true);
      }
      changed = true;
    }

    return { changed, preconditions };
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
  id: 'promise_constructor_to_async',
  lang: 'typescript',
  apply: transform,
};
