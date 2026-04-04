// src/adapters/typescript/index.ts
import { execa } from 'execa';
import fs from 'fs/promises';
import path from 'path';
import { InMemoryImportGraph } from '../../analysis/import-graph.js';
import { InMemoryCallGraph } from '../../analysis/call-graph.js';
import { generateUnifiedDiff } from '../../infrastructure/diff.js';
import type { ILanguageAdapter, ImportGraph, CallGraph, TransformResult } from '../interface.js';
import type { CodeIssue, CheckResult } from '../../core/models.js';

export class TypeScriptAdapter implements ILanguageAdapter {
  readonly name = 'typescript';
  readonly extensions = ['.ts', '.tsx'];
  readonly displayName = 'TypeScript';

  async detect(projectRoot: string): Promise<boolean> {
    try {
      await fs.access(path.join(projectRoot, 'tsconfig.json'));
      return true;
    } catch {
      return false;
    }
  }

  async analyze(_files: string[]): Promise<CodeIssue[]> {
    return [];
  }

  async transform(
    _file: string,
    code: string,
    issue: CodeIssue,
  ): Promise<TransformResult> {
    if (issue.fixerName === 'trailing-whitespace') {
      return {
        transformedCode: code.replace(/[ \t]+$/gm, ''),
        description: 'Remove trailing whitespace',
        riskLevel: 'low',
      };
    }
    return {
      transformedCode: code,
      description: 'No transformation available',
      riskLevel: 'low',
    };
  }

  async verifySyntax(_filePath: string, code: string): Promise<CheckResult> {
    const start = Date.now();
    try {
      // Dynamically import typescript to avoid top-level dependency issues
      const ts = await import('typescript');
      const sf = ts.createSourceFile(
        'verify.ts',
        code,
        ts.ScriptTarget.ES2022,
        true,
        ts.ScriptKind.TS,
      );
      // parseDiagnostics is internal; use getChildren to trigger parse
      const diagnostics = (sf as unknown as { parseDiagnostics?: unknown[] })
        .parseDiagnostics;
      if (Array.isArray(diagnostics) && diagnostics.length > 0) {
        return {
          passed: false,
          durationMs: Date.now() - start,
          blockingReason: 'TypeScript parse errors detected',
        };
      }
      return { passed: true, durationMs: Date.now() - start };
    } catch (err) {
      return {
        passed: false,
        durationMs: Date.now() - start,
        blockingReason: String(err),
      };
    }
  }

  async verifyImports(_filePath: string, _code: string): Promise<CheckResult> {
    const start = Date.now();
    return { passed: true, durationMs: Date.now() - start };
  }

  async verifyTests(filePath: string, _code: string): Promise<CheckResult> {
    const start = Date.now();
    const dir = path.dirname(filePath);

    try {
      const result = await execa('npx', ['vitest', 'run', dir, '--reporter=verbose'], {
        timeout: 45_000,
        cwd: process.cwd(),
      });
      return { passed: result.exitCode === 0, durationMs: Date.now() - start };
    } catch (err) {
      const error = err as { stderr?: string; stdout?: string };
      return {
        passed: false,
        durationMs: Date.now() - start,
        blockingReason: ((error.stderr ?? '') + (error.stdout ?? '')).slice(0, 500),
      };
    }
  }

  generateDiff(original: string, transformed: string): string {
    return generateUnifiedDiff('file.ts', original, transformed);
  }

  async buildImportGraph(_projectRoot: string): Promise<ImportGraph> {
    return new InMemoryImportGraph();
  }

  async buildCallGraph(_files: string[]): Promise<CallGraph> {
    return new InMemoryCallGraph();
  }
}
