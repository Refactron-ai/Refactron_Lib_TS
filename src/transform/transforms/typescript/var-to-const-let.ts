import {
  Node,
  SyntaxKind,
  VariableDeclarationKind,
  type SourceFile,
  type VariableDeclarationList,
} from 'ts-morph';
import type { TransformContext, TransformResult, TransformImpl } from '../../types.js';
import { withProject, type TsPrecondition } from './_shared.js';

/**
 * True if `idNode` is the left-hand side of an assignment or the operand of
 * `++`/`--` — i.e. the binding it refers to is reassigned at this site.
 */
function isReassignment(idNode: Node): boolean {
  const parent = idNode.getParent();
  if (!parent) return false;
  if (Node.isBinaryExpression(parent)) {
    const op = parent.getOperatorToken().getText();
    const assignOps = new Set([
      '=',
      '+=',
      '-=',
      '*=',
      '/=',
      '%=',
      '**=',
      '<<=',
      '>>=',
      '>>>=',
      '&=',
      '|=',
      '^=',
      '&&=',
      '||=',
      '??=',
    ]);
    if (assignOps.has(op) && parent.getLeft() === idNode) {
      return true;
    }
  }
  if (Node.isPostfixUnaryExpression(parent) || Node.isPrefixUnaryExpression(parent)) {
    const opTok = parent.getOperatorToken();
    if (opTok === SyntaxKind.PlusPlusToken || opTok === SyntaxKind.MinusMinusToken) {
      return true;
    }
  }
  return false;
}

/**
 * The lexical region a `var` would be narrowed to under `let`/`const`.
 *
 *  - `for (var i …)`         → the iteration statement itself. A `let` here is
 *                              scoped to the loop, so any use of `i` outside
 *                              the loop would become a ReferenceError.
 *  - `{ var x … }` in a block → the enclosing block/source file. `var` leaks to
 *                              the whole function; `let`/`const` do not. Any use
 *                              outside the enclosing block must block conversion.
 *
 * Returns the node whose text range a reference must fall inside for the
 * conversion to preserve behaviour.
 */
function narrowingScope(dl: VariableDeclarationList): Node {
  const parent = dl.getParent();
  if (!parent) return dl;
  if (
    Node.isForStatement(parent) ||
    Node.isForInStatement(parent) ||
    Node.isForOfStatement(parent)
  ) {
    return parent;
  }
  if (Node.isVariableStatement(parent)) {
    return parent.getParent() ?? parent;
  }
  return parent;
}

interface ListVerdict {
  /** null → safe to convert; otherwise the precondition that blocks it. */
  block: TsPrecondition | null;
  reassigned: boolean;
}

/**
 * Decide whether a single `var` declaration list can be converted, and to
 * what. Uses ts-morph symbol resolution (`findReferencesAsNodes`) so the
 * analysis is scope-correct: a `var count` in one function is never confused
 * with a same-named `var count` in another.
 */
function classifyList(dl: VariableDeclarationList): ListVerdict {
  const scope = narrowingScope(dl);
  const scopeStart = scope.getStart();
  const scopeEnd = scope.getEnd();
  let reassigned = false;

  for (const decl of dl.getDeclarations()) {
    const nameNode = decl.getNameNode();
    const name = decl.getName();

    // Destructuring binding patterns: ts-morph reference resolution does not
    // map cleanly onto the individual names. Conservatively skip the list.
    if (!Node.isIdentifier(nameNode)) {
      return {
        block: {
          id: `binding-pattern:${name}`,
          satisfied: false,
          reason: `${name} uses a destructuring pattern; conversion skipped`,
        },
        reassigned: false,
      };
    }

    const declStart = decl.getStart();
    const refs = nameNode.findReferencesAsNodes();

    for (const ref of refs) {
      if (ref === nameNode) continue;

      // Used before its own declaration (hoisting / temporal-dead-zone trap):
      // legal under `var`, a ReferenceError under `let`/`const`.
      if (ref.getStart() < declStart) {
        return {
          block: {
            id: `hoisting:${name}`,
            satisfied: false,
            reason: `${name} is read before its declaration; conversion would trip the temporal dead zone`,
          },
          reassigned: false,
        };
      }

      // Used outside the region the binding would be narrowed to. `var` leaks
      // to the whole function; `let`/`const` would not reach this reference.
      if (ref.getStart() < scopeStart || ref.getEnd() > scopeEnd) {
        return {
          block: {
            id: `scope-escape:${name}`,
            satisfied: false,
            reason: `${name} is used outside the block it would be scoped to under let/const`,
          },
          reassigned: false,
        };
      }

      if (isReassignment(ref)) {
        reassigned = true;
      }
    }
  }

  return { block: null, reassigned };
}

export async function transform(ctx: TransformContext): Promise<TransformResult> {
  const result = withProject(ctx.absPath, ctx.source, (sf: SourceFile) => {
    const preconditions: TsPrecondition[] = [];

    // Collect every `var` declaration list anywhere in the file. Using
    // VariableDeclarationList (not VariableStatement) is deliberate: a
    // `for (var i …)` initializer is a bare list with no enclosing statement,
    // so a VariableStatement-only scan silently misses every for-loop var.
    const lists = sf
      .getDescendantsOfKind(SyntaxKind.VariableDeclarationList)
      .filter((dl) => dl.getDeclarationKind() === VariableDeclarationKind.Var);

    if (lists.length === 0) {
      return { changed: false, preconditions };
    }

    let changed = false;
    for (const dl of lists) {
      const verdict = classifyList(dl);
      if (verdict.block) {
        // One unconvertible list does not abort the file — every other `var`
        // is still converted independently.
        preconditions.push(verdict.block);
        continue;
      }
      dl.setDeclarationKind(
        verdict.reassigned ? VariableDeclarationKind.Let : VariableDeclarationKind.Const,
      );
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
  id: 'var_to_const_let',
  lang: 'typescript',
  apply: transform,
};
