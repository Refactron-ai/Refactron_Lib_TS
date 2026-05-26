// Empirically calibrated remediation costs per transform per execution plan Day 20.
// Each cost is "minutes to hand-apply this transform once, including a code review pass."

import type { Finding, TransformId } from '../contracts.js';

export const REMEDIATION_MINUTES_BY_TRANSFORM: Record<TransformId, number> = {
  callback_to_async_await: 7,
  format_to_fstring: 2,
  manual_typecheck_to_hints: 5,
  deprecated_api_requests_to_httpx: 4,
  class_to_dataclass: 3,
  var_to_const_let: 1,
  promise_chains_to_async: 3,
  implicit_any: 2,
  commonjs_to_esm: 2,
  promise_constructor_to_async: 5,
  // v0.3.0 — both are mechanical one-line edits in the conservative form
  // the transform emits; cost dominated by the code-review pass.
  super_no_args: 1,
  lru_cache_to_cache: 1,
  // PEP 585 / 604 are mostly mechanical, but the runtime-eval / version-gate
  // analysis and the import cleanup pass are non-trivial when done by hand.
  pep585_generics: 2,
  pep604_optional_union: 2,
  // v0.3.0 Phase 3 — mechanical one-line edits; review pass dominates the cost.
  datetime_utc_alias: 1,
  yield_from_for_loop: 1,
  // v0.3.0 Phase 4 — TS idiom rewrites. indexOf→includes and Object.assign→spread
  // are mechanical one-liners; template-literal rewrites can span longer
  // expressions and warrant a slightly longer review pass.
  indexof_to_includes: 1,
  object_assign_to_spread: 2,
  string_concat_to_template_literal: 2,
  // v0.3.0 Phase 5 — Vue 2 reactivity helper rewrites are mechanical one-line
  // edits per call site, but reviewers must check the Vue version assumption.
  vue_set_delete_to_assignment: 2,
};

export function totalRemediationMinutes(findings: Finding[]): number {
  return findings.reduce((acc, f) => acc + f.remediationMinutes, 0);
}
