// src/cli/v2-adapters.ts
// Boundary adapter: maps v2 DetectorFinding → legacy CodeIssue so the existing
// IssueBrowser (and the rest of the TUI surface) can render v2 analyzer output
// without modification. Keeps WorkSession persistence on the legacy shape.
import type { CodeIssue, Severity, BlastLevel } from '../core/models.js';
import type { DetectorFinding, Confidence } from '../analyze/detectors/types.js';
import type { TransformId } from '../contracts.js';

export const MESSAGE_BY_TRANSFORM: Record<TransformId, string> = {
  callback_to_async_await: 'callback-style function can be converted to async/await',
  format_to_fstring: 'old-style string formatting can be converted to an f-string',
  manual_typecheck_to_hints: 'isinstance chain can be expressed as a type annotation',
  deprecated_api_requests_to_httpx: 'requests library can be migrated to httpx',
  class_to_dataclass: 'class can be converted to @dataclass',
  var_to_const_let: 'var declaration can be replaced with const or let',
  promise_chains_to_async: '.then chain can be flattened with async/await',
  implicit_any: 'parameter can be typed from call-site inference',
  commonjs_to_esm: 'CommonJS require/exports can be converted to ESM',
  promise_constructor_to_async: 'new Promise constructor can be expressed as an async function',
  super_no_args: 'super(Class, self) can use the implicit Python 3 zero-arg super()',
  lru_cache_to_cache: '@lru_cache(maxsize=None) can use the simpler @functools.cache',
  pep585_generics: 'typing.List/Dict/... can use the lowercase builtin generic (PEP 585)',
  pep604_optional_union: 'Optional[X] / Union[A, B] can use the X | None / A | B syntax (PEP 604)',
  datetime_utc_alias: '`datetime.timezone.utc` can use the shorter `datetime.UTC` alias',
  yield_from_for_loop: '`for x in y: yield x` can be expressed as `yield from y`',
  indexof_to_includes: 'indexOf(...) !== -1 can use the .includes(...) method (ES2016+)',
  object_assign_to_spread:
    'Object.assign({}, ...) can use the object spread syntax `{ ...a, ...b }` (ES2018+)',
  string_concat_to_template_literal:
    'string concatenation with `+` can use a template literal (ES2015+)',
  vue_set_delete_to_assignment:
    'Vue.set/Vue.delete (or this.$set/this.$delete) can use plain assignment / delete (Vue 3)',
};

/**
 * Tier classifies a transform by how strong the case for applying it is:
 *
 *   - `debt`: real maintenance burden with a forward-looking argument
 *     (deprecation timer, known bug class, Py2 / Vue 2 holdover). Worth a
 *     dedicated PR.
 *   - `modernization`: newer form is clearly better, but the old form still
 *     works. Worth doing opportunistically alongside other work.
 *   - `style`: semantically identical to the old form, pure preference.
 *     Worth doing only on files you are already touching.
 */
export type TransformTier = 'debt' | 'modernization' | 'style';

export const TIER_BY_TRANSFORM: Record<TransformId, TransformTier> = {
  // — debt —
  super_no_args: 'debt',
  pep585_generics: 'debt',
  var_to_const_let: 'debt',
  implicit_any: 'debt',
  commonjs_to_esm: 'debt',
  vue_set_delete_to_assignment: 'debt',
  // — modernization —
  callback_to_async_await: 'modernization',
  manual_typecheck_to_hints: 'modernization',
  deprecated_api_requests_to_httpx: 'modernization',
  class_to_dataclass: 'modernization',
  promise_chains_to_async: 'modernization',
  promise_constructor_to_async: 'modernization',
  lru_cache_to_cache: 'modernization',
  indexof_to_includes: 'modernization',
  object_assign_to_spread: 'modernization',
  yield_from_for_loop: 'modernization',
  // — style —
  format_to_fstring: 'style',
  pep604_optional_union: 'style',
  datetime_utc_alias: 'style',
  string_concat_to_template_literal: 'style',
};

export const SUGGESTION_BY_TRANSFORM: Record<TransformId, string> = {
  callback_to_async_await:
    'Mark the function `async`, drop the callback parameter, and `return` the value instead.',
  format_to_fstring: 'Rewrite as `f"…{var}…"` for readability and type-safety.',
  manual_typecheck_to_hints:
    'Replace the isinstance chain with `param: Union[A, B]` (or `A | B` on Python 3.10+).',
  deprecated_api_requests_to_httpx:
    'Swap `requests` for `httpx`. Public surface is mostly identical.',
  class_to_dataclass: 'Apply `@dataclass` and remove the manual `__init__` boilerplate.',
  var_to_const_let: 'Use `const` for never-reassigned bindings; `let` otherwise.',
  promise_chains_to_async: 'Mark the function `async` and replace `.then` with `await`.',
  implicit_any: 'Add the inferred primitive type annotation.',
  commonjs_to_esm: 'Replace `require()` with `import` and `module.exports` with `export`.',
  promise_constructor_to_async:
    'Rewrite as a top-level async function returning the resolved value.',
  super_no_args: 'Replace `super(ClassName, self).method(...)` with `super().method(...)`.',
  lru_cache_to_cache:
    'On Python ≥ 3.9, prefer `@functools.cache` over `@functools.lru_cache(maxsize=None)`.',
  pep585_generics:
    'On Python ≥ 3.9 (or with `from __future__ import annotations`), prefer the lowercase builtin generic — e.g. `list[str]` instead of `List[str]`.',
  pep604_optional_union:
    'On Python ≥ 3.10 (or with `from __future__ import annotations`), prefer `X | None` over `Optional[X]` and `A | B` over `Union[A, B]`.',
  datetime_utc_alias:
    'On Python ≥ 3.11, prefer `datetime.UTC` (or `UTC` imported from datetime) over the longer `datetime.timezone.utc`.',
  yield_from_for_loop:
    'Replace the trivial `for x in iter: yield x` loop with `yield from iter`. Note: not equivalent when the loop has an `else:` branch.',
  indexof_to_includes:
    'Replace `arr.indexOf(x) !== -1` with `arr.includes(x)` (and the negative form with `!arr.includes(x)`). Requires an ES2016+ target.',
  object_assign_to_spread:
    'Replace `Object.assign({}, a, b)` with the spread object literal `{ ...a, ...b }`. Requires an ES2018+ target.',
  string_concat_to_template_literal:
    'Replace `"…" + x + "…"` with a template literal `` `…${x}…` ``. Requires an ES2015+ target.',
  vue_set_delete_to_assignment:
    'Replace `Vue.set(obj, k, v)` / `this.$set(...)` with `obj[k] = v` and `Vue.delete(obj, k)` / `this.$delete(...)` with `delete obj[k]`. SAFE on Vue 3 (Proxy reactivity); on Vue 2 this changes semantics — Vue.set is required to add NEW reactive keys. Exclude this transform on Vue 2 codebases. .vue SFCs are out of scope for v0.2.3.',
};

function confidenceToSeverity(c: Confidence): Severity {
  if (c === 'high') return 'high';
  if (c === 'medium') return 'medium';
  return 'low';
}

const STUB_BLAST_LEVEL: BlastLevel = 'trivial';

export function findingToIssue(finding: DetectorFinding): CodeIssue {
  return {
    id: finding.id,
    file: finding.file,
    line: finding.line,
    severity: confidenceToSeverity(finding.confidence),
    type: finding.transformId,
    message: MESSAGE_BY_TRANSFORM[finding.transformId],
    suggestion: SUGGESTION_BY_TRANSFORM[finding.transformId],
    fixable: true,
    fixerName: finding.transformId,
    ruleId: `refactron/${finding.transformId}`,
    blastRadius: {
      affectedFiles: [],
      affectedFunctions: [],
      affectedTestFiles: [],
      score: 0,
      level: STUB_BLAST_LEVEL,
    },
  };
}

export function findingsToIssues(findings: DetectorFinding[]): CodeIssue[] {
  return findings.map(findingToIssue);
}
