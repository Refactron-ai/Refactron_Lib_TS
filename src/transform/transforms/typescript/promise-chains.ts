import { Node, type SourceFile } from 'ts-morph';
import type { TransformContext, TransformResult, TransformImpl } from '../../types.js';
import { withProject, type TsPrecondition } from './_shared.js';

// Function-like nodes ts-morph exposes that may declare `async`.
type FunctionLike =
  | ReturnType<SourceFile['getFunctions']>[number]
  | ReturnType<SourceFile['getDescendantsOfKind']>[number];

function stripParens(s: string): string {
  const t = s.trim();
  if (t.startsWith('(') && t.endsWith(')')) {
    return t.slice(1, -1).trim();
  }
  return t;
}

// Two chain shapes — see plan. `s` flag for dotall so multi-line bodies match.
const SHAPE_A =
  /^\s*return\s+(.+?)\.then\(\s*(\([^)]*\)|[a-zA-Z_$][\w$]*)\s*=>\s*(.+?)\)\s*\.then\(\s*(\([^)]*\)|[a-zA-Z_$][\w$]*)\s*=>\s*(.+?)\)\s*;?\s*$/s;

const SHAPE_B =
  /^\s*return\s+(.+?)\.then\(\s*(\([^)]*\)|[a-zA-Z_$][\w$]*)\s*=>\s*(.+?)\.then\(\s*(\([^)]*\)|[a-zA-Z_$][\w$]*)\s*=>\s*(.+?)\s*\)\s*\)\s*;?\s*$/s;

const HAZARD_RE = /Promise\.(all|race|allSettled|any)\b/;
const CATCH_RE = /\.catch\(/;

interface RewriteOutcome {
  text: string | null;
  precondition?: TsPrecondition;
}

function rewriteBody(bodyText: string): RewriteOutcome {
  if (CATCH_RE.test(bodyText)) {
    return {
      text: null,
      precondition: {
        id: 'no-catch',
        satisfied: false,
        reason: '.catch() handlers not yet supported',
      },
    };
  }
  if (HAZARD_RE.test(bodyText)) {
    return {
      text: null,
      precondition: {
        id: 'no-promise-combinator',
        satisfied: false,
        reason: 'Promise.all/race/allSettled/any not yet supported',
      },
    };
  }

  // Try the nested (more specific) shape first; SHAPE_A's lazy quantifiers can
  // otherwise consume the inner `.then(` of a nested chain and mis-group.
  const mb = bodyText.match(SHAPE_B);
  if (mb) {
    const [, a, p1Raw, b, p2Raw, ret] = mb;
    if (a && p1Raw !== undefined && b && p2Raw !== undefined && ret) {
      const p1 = stripParens(p1Raw);
      const p2 = stripParens(p2Raw);
      return {
        text: `const ${p1} = await ${a.trim()};\nconst ${p2} = await ${b.trim()};\nreturn ${ret.trim()};`,
      };
    }
  }

  const ma = bodyText.match(SHAPE_A);
  if (ma) {
    const [, a, p1Raw, b, p2Raw, c] = ma;
    if (a && p1Raw !== undefined && b && p2Raw !== undefined && c) {
      const p1 = stripParens(p1Raw);
      const p2 = stripParens(p2Raw);
      return {
        text: `const ${p1} = await ${a.trim()};\nconst ${p2} = await (${b.trim()});\nreturn ${c.trim()};`,
      };
    }
  }

  return {
    text: null,
    precondition: {
      id: 'unsupported-shape',
      satisfied: false,
      reason: 'Promise chain shape not recognised by Week 4 regex rewriter',
    },
  };
}

function isAsyncFn(fn: FunctionLike): boolean {
  const maybe = fn as unknown as { isAsync?: () => boolean };
  return typeof maybe.isAsync === 'function' ? maybe.isAsync() : false;
}

function isForgotten(fn: FunctionLike): boolean {
  const maybe = fn as unknown as { wasForgotten?: () => boolean };
  return typeof maybe.wasForgotten === 'function' ? maybe.wasForgotten() : false;
}

function setAsync(fn: FunctionLike, value: boolean): void {
  const maybe = fn as unknown as { setIsAsync?: (v: boolean) => unknown };
  if (typeof maybe.setIsAsync === 'function') {
    maybe.setIsAsync(value);
  }
}

function getBodyBlockText(fn: FunctionLike): string | null {
  const maybe = fn as unknown as { getBody?: () => Node | undefined };
  if (typeof maybe.getBody !== 'function') return null;
  const body = maybe.getBody();
  if (!body) return null;
  if (!Node.isBlock(body)) return null;
  // Return only the statements text, not the surrounding braces.
  const inner = body.getStatements().map((s) => s.getText()).join('\n');
  return inner;
}

function setBody(fn: FunctionLike, text: string): void {
  const maybe = fn as unknown as { setBodyText?: (t: string) => unknown };
  if (typeof maybe.setBodyText === 'function') {
    maybe.setBodyText(text);
  }
}

export async function transform(ctx: TransformContext): Promise<TransformResult> {
  const result = withProject(ctx.absPath, ctx.source, (sf: SourceFile) => {
    const preconditions: TsPrecondition[] = [];

    const candidates: FunctionLike[] = [
      ...sf.getFunctions(),
      ...sf.getDescendants().filter((n) => {
        return (
          Node.isArrowFunction(n) ||
          Node.isFunctionExpression(n) ||
          Node.isMethodDeclaration(n)
        );
      }),
    ] as FunctionLike[];

    let changed = false;
    for (const fn of candidates) {
      if (isForgotten(fn)) continue;
      if (isAsyncFn(fn)) continue;
      const bodyText = getBodyBlockText(fn);
      if (bodyText === null) continue;
      if (!bodyText.includes('.then(')) continue;

      const outcome = rewriteBody(bodyText);
      if (outcome.text === null) {
        if (outcome.precondition) preconditions.push(outcome.precondition);
        continue;
      }
      setAsync(fn, true);
      setBody(fn, outcome.text);
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
  id: 'promise_chains_to_async',
  lang: 'typescript',
  apply: transform,
};
