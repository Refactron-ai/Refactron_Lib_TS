// src/analyze/detectors/python/datetime-timezone-utc.ts
// Detect `datetime.timezone.utc` (and the equivalent forms after various
// imports) as a candidate for the Python 3.11+ shorthand `datetime.UTC`.
//
// Matched forms (each requires the appropriate import to be in scope):
//   * `datetime.timezone.utc`        — after `import datetime`.
//   * `dt.timezone.utc`              — after `import datetime as dt`.
//   * `timezone.utc`                 — after `from datetime import timezone`.
//   * `tz.utc`                       — after `from datetime import timezone as tz`.
//
// The detector does NOT enforce the version gate — the transform refuses with
// `python_version_too_low` when the project targets < 3.11 (or unknown). We
// also do NOT match the constructor call `datetime.timezone(timedelta(...))`
// (that's a parameterized tz, not the canonical UTC singleton).
import type { SyntaxNode } from 'tree-sitter';
import type { DetectorContext, DetectorFinding } from '../types.js';
import { register } from '../index.js';

const REMEDIATION = 1;

export function detect(ctx: DetectorContext): DetectorFinding[] {
  const findings: DetectorFinding[] = [];
  let counter = 0;

  // Discover the local names bound to:
  //   * `datetime` (module): `import datetime` / `import datetime as dt`.
  //   * `datetime.timezone`: `from datetime import timezone` /
  //     `from datetime import timezone as tz`.
  const datetimeModuleAliases = new Set<string>();
  const timezoneAliases = new Set<string>();

  // Only scan TOP-LEVEL imports. A function-local `import datetime` is not
  // visible to module-level use-sites, and the sidecar's `_collect_aliases`
  // only inspects the module body too -- if we recursed and added a function-
  // local alias here, the detector would fire on a module-level
  // `datetime.timezone.utc` but the transform would refuse (no top-level
  // import), producing a user-visible mismatch.
  function scanTopLevelImport(node: SyntaxNode): void {
    if (node.type === 'import_statement') {
      for (const child of node.namedChildren) {
        if (child.type === 'dotted_name' && child.text === 'datetime') {
          datetimeModuleAliases.add('datetime');
        }
        if (
          child.type === 'aliased_import' &&
          child.childForFieldName('name')?.text === 'datetime'
        ) {
          const alias = child.childForFieldName('alias');
          if (alias) datetimeModuleAliases.add(alias.text);
        }
      }
    } else if (node.type === 'import_from_statement') {
      const mod = node.childForFieldName('module_name');
      if (mod && mod.text === 'datetime') {
        for (const child of node.namedChildren) {
          if (child === mod) continue;
          if (child.type === 'dotted_name' && child.text === 'timezone') {
            timezoneAliases.add('timezone');
          } else if (
            child.type === 'aliased_import' &&
            child.childForFieldName('name')?.text === 'timezone'
          ) {
            const alias = child.childForFieldName('alias');
            if (alias) timezoneAliases.add(alias.text);
          }
        }
      }
    }
  }
  for (const top of ctx.tree.rootNode.namedChildren) scanTopLevelImport(top);

  function push(row: number): void {
    findings.push({
      id: `dt-utc-${ctx.relPath}-${row}-${counter++}`,
      file: ctx.relPath,
      line: row + 1,
      transformId: 'datetime_utc_alias',
      remediationMinutes: REMEDIATION,
      confidence: 'high',
    });
  }

  function visit(node: SyntaxNode): void {
    if (node.type === 'attribute') {
      const obj = node.childForFieldName('object');
      const attr = node.childForFieldName('attribute');
      if (!obj || !attr || attr.text !== 'utc') {
        // Keep walking — there may be inner attribute matches.
      } else {
        // Case A: <dt-mod>.timezone.utc — `obj` is itself an `attribute`
        // node `<dt-mod>.timezone`.
        if (obj.type === 'attribute') {
          const innerObj = obj.childForFieldName('object');
          const innerAttr = obj.childForFieldName('attribute');
          if (
            innerObj &&
            innerAttr &&
            innerObj.type === 'identifier' &&
            datetimeModuleAliases.has(innerObj.text) &&
            innerAttr.text === 'timezone'
          ) {
            push(node.startPosition.row);
          }
        }
        // Case B: <tz-alias>.utc — `obj` is a bare identifier that the user
        // bound via `from datetime import timezone [as tz]`.
        if (obj.type === 'identifier' && timezoneAliases.has(obj.text)) {
          push(node.startPosition.row);
        }
      }
    }
    for (const c of node.namedChildren) visit(c);
  }
  visit(ctx.tree.rootNode);
  return findings;
}

register({ transformId: 'datetime_utc_alias', lang: 'python', detect });
