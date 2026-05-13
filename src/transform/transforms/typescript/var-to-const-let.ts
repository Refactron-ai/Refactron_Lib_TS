import { Node, SyntaxKind, VariableDeclarationKind, type SourceFile } from 'ts-morph';
import type { TransformContext, TransformResult, TransformImpl } from '../../types.js';
import { withProject, type TsPrecondition } from './_shared.js';

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

export async function transform(ctx: TransformContext): Promise<TransformResult> {
  const result = withProject(ctx.absPath, ctx.source, (sf: SourceFile) => {
    const preconditions: TsPrecondition[] = [];
    const allIdentifiers = sf.getDescendantsOfKind(SyntaxKind.Identifier);

    // sf.getVariableStatements() only returns TOP-LEVEL statements; we need
    // every var anywhere in the file (e.g. inside functions, blocks, classes).
    const statements = sf
      .getDescendantsOfKind(SyntaxKind.VariableStatement)
      .filter((vs) => vs.getDeclarationKind() === VariableDeclarationKind.Var);

    if (statements.length === 0) {
      return { changed: false, preconditions };
    }

    // Hoisting check: if any var name is referenced (as an Identifier) before the var
    // statement's start, we skip the entire file.
    for (const vs of statements) {
      const stmtStart = vs.getStart();
      for (const decl of vs.getDeclarations()) {
        const name = decl.getName();
        const nameNode = decl.getNameNode();
        for (const id of allIdentifiers) {
          if (id === nameNode) continue;
          if (id.getText() !== name) continue;
          if (id.getStart() < stmtStart) {
            preconditions.push({
              id: `hoisting:${name}`,
              satisfied: false,
              reason: `${name} is referenced before its var declaration`,
            });
            return { changed: false, preconditions };
          }
        }
      }
    }

    let changed = false;
    for (const vs of statements) {
      let reassigned = false;
      for (const decl of vs.getDeclarations()) {
        const name = decl.getName();
        const nameNode = decl.getNameNode();
        for (const id of allIdentifiers) {
          if (id === nameNode) continue;
          if (id.getText() !== name) continue;
          if (isReassignment(id)) {
            reassigned = true;
            break;
          }
        }
        if (reassigned) break;
      }
      vs.setDeclarationKind(
        reassigned ? VariableDeclarationKind.Let : VariableDeclarationKind.Const,
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
