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
