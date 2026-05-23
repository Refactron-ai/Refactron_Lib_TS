// src/analyze/detectors/python/typing-generic.ts
// Detect PEP 585 conversion candidates: subscripted uses of the
// `typing.X[...]` (or bare `X[...]` after `from typing import X`) where X is
// one of the typing names that has a lowercase-builtin / `collections.abc` /
// `re` equivalent on Python >= 3.9. The transform sidecar handles the
// version gate and the runtime-eval refusal; the detector just surfaces the
// candidate.
//
// `typing.Optional` and `typing.Union` are INTENTIONALLY out of scope here —
// they are owned by the separate `pep604_optional_union` detector/transform.
import type { SyntaxNode } from 'tree-sitter';
import type { DetectorContext, DetectorFinding } from '../types.js';
import { register } from '../index.js';

const REMEDIATION = 2;

// typing-name -> "kind" tag for the detector (informational only; the
// transform is what actually rewrites).
const TARGETS: Set<string> = new Set([
  // Lowercase-builtin set.
  'List',
  'Dict',
  'Tuple',
  'Set',
  'FrozenSet',
  'Type',
  // collections.* set.
  'DefaultDict',
  'OrderedDict',
  'Counter',
  'Deque',
  'ChainMap',
  // collections.abc set.
  'AbstractSet',
  'MutableSet',
  'Mapping',
  'MutableMapping',
  'Sequence',
  'MutableSequence',
  'Iterable',
  'Iterator',
  'Generator',
  'AsyncIterable',
  'AsyncIterator',
  'Awaitable',
  'Coroutine',
  'Collection',
  'Container',
  'Hashable',
  'Sized',
  'Reversible',
  'KeysView',
  'ValuesView',
  'ItemsView',
  'MappingView',
  'Callable',
  // re.*.
  'Pattern',
  'Match',
]);

export function detect(ctx: DetectorContext): DetectorFinding[] {
  const findings: DetectorFinding[] = [];
  let counter = 0;

  // Discover the local names bound to `typing` (module) and the typing names
  // pulled in via `from typing import X`. Only the bare or no-op-aliased
  // forms count as "in scope under the canonical name" — a genuine
  // `from typing import List as L` rename means the user's `L[...]` site
  // can't be rewritten with our current rules, so we don't emit a finding.
  const typingModuleAliases = new Set<string>();
  const typingBareNames = new Set<string>();
  let hasTypingStar = false;

  function scanImports(node: SyntaxNode): void {
    if (node.type === 'import_statement') {
      for (const child of node.namedChildren) {
        if (child.type === 'dotted_name' && child.text === 'typing') {
          typingModuleAliases.add('typing');
        } else if (
          child.type === 'aliased_import' &&
          child.childForFieldName('name')?.text === 'typing'
        ) {
          const alias = child.childForFieldName('alias');
          if (alias) typingModuleAliases.add(alias.text);
        }
      }
    } else if (node.type === 'import_from_statement') {
      const mod = node.childForFieldName('module_name');
      if (mod && mod.text === 'typing') {
        for (const child of node.namedChildren) {
          if (child === mod) continue;
          if (child.type === 'wildcard_import') {
            hasTypingStar = true;
            continue;
          }
          if (child.type === 'dotted_name' && TARGETS.has(child.text)) {
            typingBareNames.add(child.text);
          } else if (child.type === 'aliased_import') {
            const nameNode = child.childForFieldName('name');
            const aliasNode = child.childForFieldName('alias');
            if (nameNode && aliasNode && nameNode.text === aliasNode.text) {
              if (TARGETS.has(nameNode.text)) typingBareNames.add(nameNode.text);
            }
          }
        }
      }
    }
    for (const c of node.namedChildren) scanImports(c);
  }
  scanImports(ctx.tree.rootNode);
  if (hasTypingStar) {
    for (const t of TARGETS) typingBareNames.add(t);
  }

  function push(row: number): void {
    findings.push({
      id: `pep585-${ctx.relPath}-${row}-${counter++}`,
      file: ctx.relPath,
      line: row + 1,
      transformId: 'pep585_generics',
      remediationMinutes: REMEDIATION,
      confidence: 'high',
    });
  }

  function nameOfSubscriptTarget(value: SyntaxNode | null): string | null {
    if (!value) return null;
    if (value.type === 'identifier' && typingBareNames.has(value.text)) {
      return value.text;
    }
    if (value.type === 'attribute') {
      const obj = value.childForFieldName('object');
      const attr = value.childForFieldName('attribute');
      if (
        obj &&
        attr &&
        obj.type === 'identifier' &&
        typingModuleAliases.has(obj.text) &&
        TARGETS.has(attr.text)
      ) {
        return attr.text;
      }
    }
    return null;
  }

  // TODO(v0.4): PEP 695 introduces `type X[T] = ...` statements (Python 3.12)
  // where the subscript on the LHS is a type-parameter binding, not a
  // generic application. Our `subscript` / `generic_type` walk currently
  // doesn't distinguish those, so a future PEP-695-using file could produce
  // spurious findings. Add a `type_alias_statement` ancestor check before
  // emitting once we bump tree-sitter-python to a version that surfaces it.
  function visit(node: SyntaxNode): void {
    if (node.type === 'subscript') {
      // tree-sitter-python uses `subscript` for non-annotation subscripts
      // and for attribute-form subscripts (`typing.List[...]` / `t.List[...]`).
      // The `value` field holds the LHS expression.
      const value = node.childForFieldName('value');
      if (value && nameOfSubscriptTarget(value) !== null) {
        push(node.startPosition.row);
      }
    } else if (node.type === 'generic_type') {
      // Bare-name subscripts inside annotation positions (e.g. `Optional[int]`
      // when there's no module-qualifier) parse as `generic_type`, with the
      // first named child being the type's identifier.
      const head = node.namedChildren[0] ?? null;
      if (head && nameOfSubscriptTarget(head) !== null) {
        push(node.startPosition.row);
      }
    }
    for (const c of node.namedChildren) visit(c);
  }
  visit(ctx.tree.rootNode);

  return findings;
}

register({ transformId: 'pep585_generics', lang: 'python', detect });
