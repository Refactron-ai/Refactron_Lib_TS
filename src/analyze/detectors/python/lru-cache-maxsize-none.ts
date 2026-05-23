// src/analyze/detectors/python/lru-cache-maxsize-none.ts
// Detect `@functools.lru_cache(maxsize=None)` and `@lru_cache(maxsize=None)`
// (after `from functools import lru_cache`). The sidecar gates the rewrite
// on Python >= 3.9 (the version that introduced `functools.cache`).
//
// The detector does NOT enforce the version gate — `analyze` should surface
// the candidate so the user sees why a given file was considered. The
// transform refuses with `python_version_too_low` when the project targets
// < 3.9 (or the version is unknown).
import type { SyntaxNode } from 'tree-sitter';
import type { DetectorContext, DetectorFinding } from '../types.js';
import { register } from '../index.js';

const REMEDIATION = 1;

export function detect(ctx: DetectorContext): DetectorFinding[] {
  const findings: DetectorFinding[] = [];
  let counter = 0;

  // Only count `lru_cache` as referring to functools.lru_cache when we see
  // either an explicit `import functools` (any prefix) or a
  // `from functools import lru_cache`. A locally-defined `lru_cache` symbol
  // would also satisfy this — that's a degenerate case we accept (the
  // sidecar refuses to rewrite when it can't confirm the import).
  let hasFunctoolsImport = false;
  let hasBareLruCacheImport = false;
  function scanImports(node: SyntaxNode): void {
    if (node.type === 'import_statement') {
      // `import functools` / `import functools as F`
      for (const child of node.namedChildren) {
        if (child.type === 'dotted_name' && child.text === 'functools') {
          hasFunctoolsImport = true;
        }
        if (
          child.type === 'aliased_import' &&
          child.childForFieldName('name')?.text === 'functools'
        ) {
          hasFunctoolsImport = true;
        }
      }
    }
    if (node.type === 'import_from_statement') {
      const mod = node.childForFieldName('module_name');
      if (mod && mod.text === 'functools') {
        for (const child of node.namedChildren) {
          // Skip the module_name field child; remaining named children are
          // the imported names (dotted_name) or aliased_import.
          if (child === mod) continue;
          if (child.type === 'dotted_name' && child.text === 'lru_cache') {
            hasBareLruCacheImport = true;
          }
          if (
            child.type === 'aliased_import' &&
            child.childForFieldName('name')?.text === 'lru_cache'
          ) {
            hasBareLruCacheImport = true;
          }
        }
      }
    }
    for (const c of node.namedChildren) scanImports(c);
  }
  scanImports(ctx.tree.rootNode);

  function push(row: number): void {
    findings.push({
      id: `lru-none-${ctx.relPath}-${row}-${counter++}`,
      file: ctx.relPath,
      line: row + 1,
      transformId: 'lru_cache_to_cache',
      remediationMinutes: REMEDIATION,
      confidence: 'high',
    });
  }

  // A decorator with the maxsize=None keyword. Looks like:
  //   decorator
  //     call
  //       function: attribute (functools.lru_cache) | identifier (lru_cache)
  //       arguments: ( keyword_argument(name=maxsize, value=None) )
  function visit(node: SyntaxNode): void {
    if (node.type === 'decorator') {
      // Decorator wraps a single expression — usually the call.
      const inner = node.namedChildren[0];
      if (inner && inner.type === 'call') {
        const fn = inner.childForFieldName('function');
        let matches = false;
        if (fn) {
          if (fn.type === 'identifier' && fn.text === 'lru_cache' && hasBareLruCacheImport) {
            matches = true;
          }
          if (fn.type === 'attribute') {
            const attr = fn.childForFieldName('attribute');
            const obj = fn.childForFieldName('object');
            if (
              attr?.text === 'lru_cache' &&
              obj?.type === 'identifier' &&
              obj.text === 'functools' &&
              hasFunctoolsImport
            ) {
              matches = true;
            }
          }
        }
        if (matches) {
          const args = inner.childForFieldName('arguments');
          if (args) {
            for (const kw of args.namedChildren) {
              if (kw.type === 'keyword_argument') {
                const name = kw.childForFieldName('name');
                const value = kw.childForFieldName('value');
                if (name?.text === 'maxsize' && value?.text === 'None') {
                  push(node.startPosition.row);
                  break;
                }
              }
            }
          }
        }
      }
    }
    for (const c of node.namedChildren) visit(c);
  }
  visit(ctx.tree.rootNode);
  return findings;
}

register({ transformId: 'lru_cache_to_cache', lang: 'python', detect });
