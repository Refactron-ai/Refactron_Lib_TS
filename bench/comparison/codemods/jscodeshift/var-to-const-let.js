/**
 * jscodeshift codemod: var -> const/let
 *
 * Strategy (the standard recipe):
 *   1. Visit every VariableDeclaration where kind === 'var'.
 *   2. For each declarator, scan the enclosing function/program scope for any
 *      reassignment of the binding (assignment, ++/--, compound op, for-of/in
 *      target). If none, eligible for const; otherwise let.
 *   3. If any binding in a multi-declarator var is reassigned, the whole
 *      statement becomes `let` (jscodeshift can't split kinds). This matches
 *      the well-known prefer-const behavior on multi-decls.
 *   4. Skip declarations with no initializer that the user *might* be relying
 *      on for var-hoisting (rare but real). We mirror ESLint's prefer-const
 *      conservative stance: declarations without an initializer that get
 *      assigned later become `let`, not `const`.
 *
 * Run:
 *   npx jscodeshift -t bench/comparison/codemods/jscodeshift/var-to-const-let.js \
 *       --extensions=ts --parser=ts <fixture-dir>
 */

module.exports = function transform(file, api) {
  const j = api.jscodeshift;
  const root = j(file.source);

  // For each var declaration, decide const vs let.
  root.find(j.VariableDeclaration, { kind: 'var' }).forEach((path) => {
    const declarators = path.node.declarations;
    const enclosingScope = path.scope;

    // Determine, per-declarator, whether the binding is ever reassigned in
    // the enclosing function scope. (Var is function-scoped, so this is the
    // correct unit of analysis.)
    let anyReassigned = false;
    let anyMissingInit = false;

    for (const d of declarators) {
      if (d.type !== 'VariableDeclarator' || d.id.type !== 'Identifier') {
        // Destructuring etc — bail out conservatively to `let`.
        anyReassigned = true;
        continue;
      }
      if (d.init == null) {
        anyMissingInit = true;
      }
      const name = d.id.name;
      const reassigned = isReassignedInScope(j, enclosingScope, name);
      if (reassigned) anyReassigned = true;
    }

    // ESLint prefer-const rule: a `var` with no initializer that is only
    // *assigned once* later still becomes `let` (because `const` requires an
    // initializer). We follow the same convention.
    const useConst = !anyReassigned && !anyMissingInit;
    path.node.kind = useConst ? 'const' : 'let';
  });

  return root.toSource({ quote: 'single' });
};

module.exports.parser = 'ts';

function isReassignedInScope(j, scope, name) {
  // Walk the scope's AST node looking for any write to `name`.
  const node = scope.path.node;
  let reassigned = false;

  j(node)
    .find(j.AssignmentExpression)
    .forEach((p) => {
      const left = p.node.left;
      if (left.type === 'Identifier' && left.name === name) {
        // Confirm it resolves to our binding, not a shadow.
        const enclosing = nearestBindingScope(p.scope, name);
        if (enclosing === scope) reassigned = true;
      }
    });

  j(node)
    .find(j.UpdateExpression)
    .forEach((p) => {
      const arg = p.node.argument;
      if (arg.type === 'Identifier' && arg.name === name) {
        const enclosing = nearestBindingScope(p.scope, name);
        if (enclosing === scope) reassigned = true;
      }
    });

  // for-in / for-of with the bare identifier as the loop variable counts as
  // reassignment per iteration.
  j(node)
    .find(j.ForInStatement)
    .forEach((p) => {
      const left = p.node.left;
      if (left.type === 'Identifier' && left.name === name) reassigned = true;
    });
  j(node)
    .find(j.ForOfStatement)
    .forEach((p) => {
      const left = p.node.left;
      if (left.type === 'Identifier' && left.name === name) reassigned = true;
    });

  return reassigned;
}

function nearestBindingScope(scope, name) {
  let s = scope;
  while (s) {
    if (s.declares && s.declares(name)) return s;
    s = s.parent;
  }
  return null;
}
