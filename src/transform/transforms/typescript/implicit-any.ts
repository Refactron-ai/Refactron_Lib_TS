import { Node, type CallExpression, type FunctionDeclaration, type SourceFile } from 'ts-morph';
import type { TransformContext, TransformResult, TransformImpl } from '../../types.js';
import { withProject, type TsPrecondition } from './_shared.js';

const PRIMITIVE_TYPES = new Set(['number', 'string', 'boolean']);

export async function transform(ctx: TransformContext): Promise<TransformResult> {
  const result = withProject(ctx.absPath, ctx.source, (sf: SourceFile) => {
    const preconditions: TsPrecondition[] = [];
    let changed = false;

    const fns = sf
      .getDescendants()
      .filter((n): n is FunctionDeclaration => Node.isFunctionDeclaration(n));

    for (const fn of fns) {
      const fnName = fn.getName();
      if (fnName === undefined) continue;

      // Collect call sites by walking references and keeping only CallExpressions
      // whose callee identifier is the reference itself (filters out the fn's own decl).
      const refs = fn.findReferencesAsNodes();
      const callExprs: CallExpression[] = [];
      for (const ref of refs) {
        const parent = ref.getParent();
        if (parent === undefined) continue;
        if (!Node.isCallExpression(parent)) continue;
        if (parent.getExpression() !== ref) continue;
        callExprs.push(parent);
      }
      if (callExprs.length === 0) continue;

      const params = fn.getParameters();
      for (let i = 0; i < params.length; i++) {
        const param = params[i];
        if (param === undefined) continue;
        if (param.getTypeNode() !== undefined) continue;
        if (param.hasInitializer()) continue;

        const observedTypes = new Set<string>();
        for (const call of callExprs) {
          const arg = call.getArguments()[i];
          if (arg === undefined) continue;
          // Widen literal types (e.g. `1` → `number`, `"a"` → `string`).
          const t = arg.getType().getBaseTypeOfLiteralType().getText();
          observedTypes.add(PRIMITIVE_TYPES.has(t) ? t : 'non-primitive');
        }

        if (observedTypes.size === 0) continue;

        if (observedTypes.size === 1 && !observedTypes.has('non-primitive')) {
          const inferred = [...observedTypes][0];
          if (inferred !== undefined) {
            param.setType(inferred);
            changed = true;
          }
        } else {
          preconditions.push({
            id: `diverging-types:${fnName}:${param.getName()}`,
            satisfied: false,
            reason: 'Call sites pass mixed or non-primitive types',
          });
        }
      }
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
  id: 'implicit_any',
  lang: 'typescript',
  apply: transform,
};
