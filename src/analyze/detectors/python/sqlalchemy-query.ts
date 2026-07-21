// src/analyze/detectors/python/sqlalchemy-query.ts
// Detect SQLAlchemy 1.x `session.query(...)` chains that should be migrated to
// the 2.0 `session.execute(select(...))` form. Classifies each candidate as
// either `safe` (the rewriter sidecar can transform it deterministically) or
// `flag` (a semantic precondition needs human attention before rewrite).
//
// We don't try to prove the receiver is a real SQLAlchemy Session — the user
// opts in via `--transforms=sqlalchemy_query_to_select`. The detector points at
// the candidate site and the sidecar (Task 7) does the rewrite.
//
// NOTE: `transformId: 'sqlalchemy_query_to_select'` is added to the locked
// `TransformId` union in Task 18 (locked-file change handled by the human
// controller). Until then we cast through `as never` / `as { meta }` so
// TypeScript stays happy without touching the locked surface.
import type { SyntaxNode } from 'tree-sitter';
import type { DetectorContext, DetectorFinding } from '../types.js';
import { register } from '../index.js';

const REMEDIATION = 25;

/** Engine flag — when true, the analyze engine builds a `coveredLines` set via
 *  `reportCoverage` once per analyze call and threads it into every
 *  `DetectorContext`. Read by `src/analyze/engine.ts` at orchestration time. */
export const NEEDS_COVERAGE = true;

/** Walk the call chain leftward from a tail call node. Returns the head
 *  attribute (e.g. `session.query` or `Model.query`), the head call node
 *  (for the method form: the `session.query(...)` call; for the class-attr
 *  form: the innermost call that sits directly on `<Name>.query.<method>`),
 *  the list of chained method names in source order, and a `form`
 *  discriminator. */
function walkChain(call: SyntaxNode): {
  head: SyntaxNode | null;
  headCall: SyntaxNode | null;
  methods: string[];
  form: 'method' | 'classattr' | null;
} {
  const rawMethods: string[] = [];
  let cur: SyntaxNode | null = call;
  let head: SyntaxNode | null = null;
  let headCall: SyntaxNode | null = null;
  while (cur && cur.type === 'call') {
    const fn = cur.childForFieldName('function');
    if (!fn || fn.type !== 'attribute') break;
    const attr = fn.childForFieldName('attribute');
    if (attr) rawMethods.push(attr.text);
    const recv = fn.childForFieldName('object');
    if (recv && recv.type === 'call') {
      cur = recv;
      continue;
    }
    head = fn;
    headCall = cur;
    break;
  }
  rawMethods.reverse(); // restore source order

  let form: 'method' | 'classattr' | null = null;
  if (head && head.type === 'attribute') {
    const headAttr = head.childForFieldName('attribute');
    if (headAttr?.text === 'query') {
      // session.query(...).chain — drop the leading "query" head method.
      form = 'method';
      if (rawMethods.length > 0) rawMethods.shift();
    } else {
      // Class-attr form: head.object is `<Name>.query` — an attribute access
      // whose own attribute is named `query`. The visited call is the head
      // call (`.filter(...)` etc.); every collected method is a real chained
      // method, so nothing to shift.
      const headObj = head.childForFieldName('object');
      if (headObj?.type === 'attribute') {
        const headObjAttr = headObj.childForFieldName('attribute');
        if (headObjAttr?.text === 'query') {
          form = 'classattr';
        }
      }
    }
  }

  return { head, headCall, methods: rawMethods, form };
}

/** Inspect the head call's args + the chained methods and classify the shape.
 *  See the v0.3.0 SQLAlchemy migration plan for the table of flag reasons.
 *  Multi-column / multi-entity head-args only apply to the method form
 *  (`session.query(<args>)`); the class-attr form (`<Name>.query.chain`) has
 *  no head-args to inspect. */
function classifyMeta(
  headCall: SyntaxNode,
  methods: string[],
  form: 'method' | 'classattr',
): { shape: 'safe' } | { shape: 'flag'; flagReason: string } {
  if (form === 'method') {
    const args = headCall.childForFieldName('arguments');
    if (args) {
      const named = args.namedChildren.filter((c) => c.type !== 'comment');
      if (named.length > 1) return { shape: 'flag', flagReason: 'multi-column-select' };
      if (named.length === 1 && named[0]!.type === 'attribute') {
        return { shape: 'flag', flagReason: 'multi-column-select' };
      }
    }
  }
  if (methods.includes('options')) {
    return { shape: 'flag', flagReason: 'joinedload-needs-unique' };
  }
  if (methods.includes('update')) {
    return { shape: 'flag', flagReason: 'bulk-update-semantics' };
  }
  if (methods.includes('delete')) {
    return { shape: 'flag', flagReason: 'bulk-delete-semantics' };
  }
  if (methods.includes('select_entity_from')) {
    return { shape: 'flag', flagReason: 'select-entity-from' };
  }
  if (methods.filter((m) => m === 'join').length >= 3) {
    return { shape: 'flag', flagReason: 'complex-joins' };
  }
  return { shape: 'safe' };
}

export function detect(ctx: DetectorContext): DetectorFinding[] {
  const findings: DetectorFinding[] = [];
  let counter = 0;
  function visit(node: SyntaxNode): void {
    if (node.type === 'call') {
      // Only treat as a candidate when this call is the OUTER call of a chain
      // (its parent is not itself a function-attribute of another call).
      const parent = node.parent;
      const isInner =
        parent?.type === 'attribute' &&
        parent.parent?.type === 'call' &&
        parent.parent.childForFieldName('function') === parent;
      if (!isInner) {
        const { headCall, methods, form } = walkChain(node);
        if (form !== null && headCall) {
          const meta = classifyMeta(headCall, methods, form);
          const normalizedRel = ctx.relPath.replace(/\\/g, '/').replace(/^\.\//, '');
          const lineKey = `${normalizedRel}:${node.startPosition.row + 1}`;
          const testCovered: 'yes' | 'no' | 'unknown' =
            ctx.coveredLines === undefined
              ? 'unknown'
              : ctx.coveredLines.has(lineKey)
                ? 'yes'
                : 'no';
          findings.push({
            id: `sql-${ctx.relPath}-${node.startPosition.row}-${counter++}`,
            file: ctx.relPath,
            line: node.startPosition.row + 1,
            transformId: 'sqlalchemy_query_to_select' as never,
            remediationMinutes: REMEDIATION,
            confidence: 'medium',
            testCovered,
            ...({ meta } as object),
          });
        }
      }
    }
    for (const c of node.namedChildren) visit(c);
  }
  visit(ctx.tree.rootNode);
  return findings;
}

register({
  // added to TransformId in Task 18 (locked-file change)
  transformId: 'sqlalchemy_query_to_select' as never,
  lang: 'python',
  detect,
});
