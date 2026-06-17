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
 *  attribute (e.g. `session.query`), the head call node (e.g. the
 *  `session.query(...)` call) and the list of method names in source order. */
function walkChain(call: SyntaxNode): {
  head: SyntaxNode | null;
  headCall: SyntaxNode | null;
  methods: string[];
} {
  const methods: string[] = [];
  let cur: SyntaxNode | null = call;
  let head: SyntaxNode | null = null;
  let headCall: SyntaxNode | null = null;
  while (cur && cur.type === 'call') {
    const fn = cur.childForFieldName('function');
    if (!fn || fn.type !== 'attribute') break;
    const attr = fn.childForFieldName('attribute');
    if (attr) methods.push(attr.text);
    const recv = fn.childForFieldName('object');
    if (recv && recv.type === 'call') {
      cur = recv;
      continue;
    }
    head = fn;
    headCall = cur;
    break;
  }
  methods.reverse(); // walker went right→left; restore source order
  // The first method in source order is the head call's own method ("query");
  // drop it so `methods` contains only the chained methods (filter, options,
  // update, delete, join, …) that the classifier inspects.
  if (methods.length > 0) methods.shift();
  return { head, headCall, methods };
}

/** True iff the head attribute resolves to `<name>.query` — i.e. a method call
 *  named `query` on some receiver. */
function isQueryHead(head: SyntaxNode | null): boolean {
  if (!head || head.type !== 'attribute') return false;
  const attr = head.childForFieldName('attribute');
  return attr?.text === 'query';
}

/** Inspect the head call's args + the chained methods and classify the shape.
 *  See the v0.3.0 SQLAlchemy migration plan for the table of flag reasons. */
function classifyMeta(
  headCall: SyntaxNode, // the `session.query(...)` call node
  methods: string[],
): { shape: 'safe' } | { shape: 'flag'; flagReason: string } {
  // Head args — flag multi-column / multi-entity at the head.
  const args = headCall.childForFieldName('arguments');
  if (args) {
    const named = args.namedChildren.filter((c) => c.type !== 'comment');
    if (named.length > 1) return { shape: 'flag', flagReason: 'multi-column-select' };
    if (named.length === 1 && named[0]!.type === 'attribute') {
      return { shape: 'flag', flagReason: 'multi-column-select' };
    }
  }
  // Method chain — flag specific shapes.
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
        const { head, headCall, methods } = walkChain(node);
        if (isQueryHead(head) && headCall) {
          const meta = classifyMeta(headCall, methods);
          const lineKey = `${ctx.relPath}:${node.startPosition.row + 1}`;
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
            // added to TransformId in Task 18 (locked-file change)
            transformId: 'sqlalchemy_query_to_select' as never,
            remediationMinutes: REMEDIATION,
            confidence: 'medium',
            testCovered,
            // `meta` is not on the locked `Finding` shape — sidecar (Task 7)
            // reads it via the same cast on the consumer side.
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
