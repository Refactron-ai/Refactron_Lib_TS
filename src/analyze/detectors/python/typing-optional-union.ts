// src/analyze/detectors/python/typing-optional-union.ts
// Detect PEP 604 conversion candidates: `typing.Optional[X]` /
// `typing.Union[A, B, ...]` and the bare-name forms after
// `from typing import Optional, Union`. The transform handles the version
// gate (>= 3.10, or `from __future__ import annotations`).
import type { SyntaxNode } from 'tree-sitter';
import type { DetectorContext, DetectorFinding } from '../types.js';
import { register } from '../index.js';

const REMEDIATION = 2;
const TARGETS = new Set(['Optional', 'Union']);

export function detect(ctx: DetectorContext): DetectorFinding[] {
  const findings: DetectorFinding[] = [];
  let counter = 0;

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

  function nameOfTarget(value: SyntaxNode | null): string | null {
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

  function push(row: number): void {
    findings.push({
      id: `pep604-${ctx.relPath}-${row}-${counter++}`,
      file: ctx.relPath,
      line: row + 1,
      transformId: 'pep604_optional_union',
      remediationMinutes: REMEDIATION,
      confidence: 'high',
    });
  }

  function visit(node: SyntaxNode): void {
    if (node.type === 'subscript') {
      const value = node.childForFieldName('value');
      if (value && nameOfTarget(value) !== null) {
        push(node.startPosition.row);
      }
    } else if (node.type === 'generic_type') {
      // Bare-name annotation subscripts (e.g. `Optional[int]` after
      // `from typing import Optional`) parse as `generic_type`. First named
      // child is the type identifier.
      const head = node.namedChildren[0] ?? null;
      if (head && nameOfTarget(head) !== null) {
        push(node.startPosition.row);
      }
    }
    for (const c of node.namedChildren) visit(c);
  }
  visit(ctx.tree.rootNode);

  return findings;
}

register({ transformId: 'pep604_optional_union', lang: 'python', detect });
