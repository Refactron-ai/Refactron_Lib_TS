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
};

export function totalRemediationMinutes(findings: Finding[]): number {
  return findings.reduce((acc, f) => acc + f.remediationMinutes, 0);
}
