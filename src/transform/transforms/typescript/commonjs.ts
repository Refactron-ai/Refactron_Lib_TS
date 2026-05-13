import { Node, SyntaxKind, type SourceFile } from 'ts-morph';
import type { TransformContext, TransformResult, TransformImpl } from '../../types.js';
import { withProject, type TsPrecondition } from './_shared.js';

const NODE_GLOBALS_RE = /\b(__dirname|__filename)\b/;
// `require(` not followed by a string literal — i.e. dynamic require.
const DYNAMIC_REQUIRE_RE = /require\(\s*(?!['"`])/;

const MODULE_EXPORTS_DEFAULT_RE = /^module\.exports\s*=\s*([A-Za-z_$][\w$]*)\s*;?\s*$/;
const MODULE_EXPORTS_OBJECT_RE = /^module\.exports\s*=\s*\{([^}]*)\}\s*;?\s*$/;
const EXPORTS_NAMED_RE = /^exports\.([A-Za-z_$][\w$]*)\s*=\s*([\s\S]+?);?\s*$/;

function parseShorthandObject(inner: string): string[] | null {
  // Accept only shorthand identifier members `{ a, b, c }`.
  const parts = inner
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const names: string[] = [];
  for (const p of parts) {
    if (!/^[A-Za-z_$][\w$]*$/.test(p)) return null;
    names.push(p);
  }
  return names;
}

export async function transform(ctx: TransformContext): Promise<TransformResult> {
  const preconditionsEarly: TsPrecondition[] = [];

  if (ctx.absPath.endsWith('.cjs')) {
    preconditionsEarly.push({
      id: 'cjs-extension',
      satisfied: false,
      reason: '.cjs files are explicitly CommonJS and not rewritten',
    });
    return { newContent: null, preconditions: preconditionsEarly };
  }
  if (NODE_GLOBALS_RE.test(ctx.source)) {
    preconditionsEarly.push({
      id: 'node-globals',
      satisfied: false,
      reason: '__dirname / __filename are not available in ESM without polyfill',
    });
    return { newContent: null, preconditions: preconditionsEarly };
  }
  if (DYNAMIC_REQUIRE_RE.test(ctx.source)) {
    preconditionsEarly.push({
      id: 'dynamic-require',
      satisfied: false,
      reason: 'Dynamic require(<expr>) calls cannot be rewritten as static imports',
    });
    return { newContent: null, preconditions: preconditionsEarly };
  }

  const result = withProject(ctx.absPath, ctx.source, (sf: SourceFile) => {
    const preconditions: TsPrecondition[] = [];
    let changed = false;

    // Pass 1: rewrite `const x = require('y')` and `const { a, b } = require('y')`.
    // Use getDescendantsOfKind so we catch require() calls inside functions/blocks
    // too — getVariableStatements() is top-level only.
    for (const vs of sf.getDescendantsOfKind(SyntaxKind.VariableStatement)) {
      const decls = vs.getDeclarations();
      if (decls.length !== 1) continue;
      const decl = decls[0];
      if (decl === undefined) continue;
      const init = decl.getInitializer();
      if (init === undefined || !Node.isCallExpression(init)) continue;
      const callee = init.getExpression();
      if (!Node.isIdentifier(callee) || callee.getText() !== 'require') continue;
      const args = init.getArguments();
      if (args.length !== 1) continue;
      const arg = args[0];
      if (arg === undefined || !Node.isStringLiteral(arg)) continue;
      const moduleSpec = arg.getLiteralValue();

      const nameNode = decl.getNameNode();
      if (Node.isIdentifier(nameNode)) {
        vs.replaceWithText(`import ${nameNode.getText()} from '${moduleSpec}';`);
        changed = true;
      } else if (Node.isObjectBindingPattern(nameNode)) {
        const names: string[] = [];
        let ok = true;
        for (const el of nameNode.getElements()) {
          // Skip non-shorthand or renamed bindings as unsupported.
          if (el.getPropertyNameNode() !== undefined) {
            ok = false;
            break;
          }
          if (el.getDotDotDotToken() !== undefined) {
            ok = false;
            break;
          }
          names.push(el.getName());
        }
        if (!ok || names.length === 0) {
          preconditions.push({
            id: 'unsupported-destructure',
            satisfied: false,
            reason: 'Only shorthand `const { a, b } = require(...)` is supported',
          });
          continue;
        }
        vs.replaceWithText(`import { ${names.join(', ')} } from '${moduleSpec}';`);
        changed = true;
      }
    }

    // Pass 2: rewrite `module.exports = ...` and `exports.X = ...` statements.
    for (const stmt of sf.getStatementsWithComments()) {
      const text = stmt.getText().trim();

      const mDefault = text.match(MODULE_EXPORTS_DEFAULT_RE);
      if (mDefault) {
        const ident = mDefault[1];
        if (ident !== undefined) {
          stmt.replaceWithText(`export default ${ident};`);
          changed = true;
          continue;
        }
      }

      const mObj = text.match(MODULE_EXPORTS_OBJECT_RE);
      if (mObj) {
        const inner = mObj[1];
        if (inner !== undefined) {
          const names = parseShorthandObject(inner);
          if (names !== null && names.length > 0) {
            stmt.replaceWithText(`export { ${names.join(', ')} };`);
            changed = true;
            continue;
          }
          preconditions.push({
            id: 'unsupported-exports-shape',
            satisfied: false,
            reason: 'module.exports object with non-shorthand members is unsupported',
          });
          continue;
        }
      }

      const mNamed = text.match(EXPORTS_NAMED_RE);
      if (mNamed) {
        const name = mNamed[1];
        const value = mNamed[2];
        if (name !== undefined && value !== undefined) {
          stmt.replaceWithText(`export const ${name} = ${value.trim()};`);
          changed = true;
          continue;
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
  id: 'commonjs_to_esm',
  lang: 'typescript',
  apply: transform,
};
