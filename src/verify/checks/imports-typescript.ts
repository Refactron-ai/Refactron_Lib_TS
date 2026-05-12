import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as ts from 'typescript';
import type { GateResult } from '../../contracts.js';

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

export async function checkTypescriptImports(
  projectRoot: string,
  files: string[],
): Promise<GateResult> {
  const t0 = Date.now();
  if (files.length === 0) return { passed: true, durationMs: 0 };
  const options = loadTsConfig(projectRoot);
  const host = ts.createCompilerHost(options, true);
  for (const file of files) {
    const text = await fs.readFile(file, 'utf8');
    const info = ts.preProcessFile(text, true, true);
    for (const ref of info.importedFiles) {
      const resolved = ts.resolveModuleName(ref.fileName, file, options, host);
      const isNodeBuiltin = /^node:/.test(ref.fileName);
      if (!resolved.resolvedModule && !isNodeBuiltin) {
        return {
          passed: false,
          durationMs: Date.now() - t0,
          blockingReason: `${file}: cannot resolve '${ref.fileName}'`,
        };
      }
    }
  }
  return { passed: true, durationMs: Date.now() - t0 };
}
