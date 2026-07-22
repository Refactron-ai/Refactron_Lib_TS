import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as ts from 'typescript';
import { builtinModules } from 'node:module';
import type { GateResult } from '../../contracts.js';

// Node builtins resolve at runtime without @types/node being present. Accept
// them by name in either bare ('path') or prefixed ('node:path') form so the
// import gate doesn't false-reject on healthy user code.
const NODE_BUILTINS = new Set<string>(builtinModules);
function isNodeBuiltin(spec: string): boolean {
  if (spec.startsWith('node:')) return true;
  return NODE_BUILTINS.has(spec);
}

function loadTsConfig(projectRoot: string): ts.CompilerOptions {
  const cfgPath = ts.findConfigFile(projectRoot, ts.sys.fileExists, 'tsconfig.json');
  if (!cfgPath) {
    return {
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      target: ts.ScriptTarget.Latest,
    };
  }
  const read = ts.readConfigFile(cfgPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(cfgPath));
  return parsed.options;
}

/**
 * Resolve every import specifier in `files` against a tsconfig rooted at
 * `projectRoot`. Returns a map from each input path (exactly as passed) to the
 * set of module specifiers that do not resolve. Node builtins never count as
 * unresolved. Every unresolvable specifier is reported so the gate can diff a
 * base file against the changed file and blame only what the change introduced.
 */
export async function collectTypescriptUnresolved(
  projectRoot: string,
  files: string[],
): Promise<Map<string, Set<string>>> {
  const result = new Map<string, Set<string>>();
  for (const f of files) result.set(f, new Set());
  if (files.length === 0) return result;

  const options = loadTsConfig(projectRoot);
  const host = ts.createCompilerHost(options, true);
  for (const file of files) {
    const set = result.get(file) ?? new Set<string>();
    const text = await fs.readFile(file, 'utf8');
    const info = ts.preProcessFile(text, true, true);
    for (const ref of info.importedFiles) {
      const resolved = ts.resolveModuleName(ref.fileName, file, options, host);
      if (!resolved.resolvedModule && !isNodeBuiltin(ref.fileName)) {
        set.add(ref.fileName);
      }
    }
    result.set(file, set);
  }
  return result;
}

/**
 * Non-delta convenience check: fails if ANY file has an unresolvable import.
 * The delta-aware gate composes {@link collectTypescriptUnresolved} against
 * base and shadow file sets instead.
 */
export async function checkTypescriptImports(
  projectRoot: string,
  files: string[],
): Promise<GateResult> {
  const t0 = Date.now();
  if (files.length === 0) return { passed: true, durationMs: 0 };
  const byFile = await collectTypescriptUnresolved(projectRoot, files);
  for (const [file, specs] of byFile) {
    if (specs.size > 0) {
      const first = [...specs][0];
      return {
        passed: false,
        durationMs: Date.now() - t0,
        blockingReason: `${file}: cannot resolve '${first}'`,
      };
    }
  }
  return { passed: true, durationMs: Date.now() - t0 };
}
