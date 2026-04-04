// src/adapters/python/index.ts
import { execa } from 'execa';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomBytes } from 'crypto';
import type { ILanguageAdapter, ImportGraph, CallGraph, TransformResult } from '../interface.js';
import type { CodeIssue, CheckResult } from '../../core/models.js';
import {
  buildPythonImportGraph,
  buildPythonCallGraph,
  analyzePythonFiles,
} from './analyzer.js';
import { transformPythonCode } from './fixer.js';
import { runPytestForFile } from './test-runner.js';
import { generateUnifiedDiff } from '../../infrastructure/diff.js';

export class PythonAdapter implements ILanguageAdapter {
  readonly name = 'python';
  readonly extensions = ['.py'];
  readonly displayName = 'Python';

  async detect(_projectRoot: string): Promise<boolean> {
    try {
      const result = await execa('python3', ['--version'], { timeout: 5_000 });
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  async analyze(files: string[]): Promise<CodeIssue[]> {
    return analyzePythonFiles(files);
  }

  async transform(file: string, code: string, issue: CodeIssue): Promise<TransformResult> {
    return transformPythonCode(file, code, issue);
  }

  async verifySyntax(_filePath: string, code: string): Promise<CheckResult> {
    const start = Date.now();
    try {
      await execa(
        'python3',
        ['-c', `import ast; ast.parse(${JSON.stringify(code)})`],
        { timeout: 10_000 },
      );
      return { passed: true, durationMs: Date.now() - start };
    } catch (err) {
      const error = err as { stderr?: string };
      return {
        passed: false,
        durationMs: Date.now() - start,
        blockingReason: (error.stderr ?? 'Syntax check failed').slice(0, 300),
      };
    }
  }

  async verifyImports(_filePath: string, code: string): Promise<CheckResult> {
    const start = Date.now();
    const tmpPath = path.join(os.tmpdir(), `refactron-verify-${randomBytes(8).toString('hex')}.py`);
    try {
      fs.writeFileSync(tmpPath, code);
      await execa(
        'python3',
        ['-c', `import py_compile; py_compile.compile(${JSON.stringify(tmpPath)}, doraise=True)`],
        { timeout: 10_000 },
      );
      return { passed: true, durationMs: Date.now() - start };
    } catch (err) {
      const error = err as { stderr?: string };
      return {
        passed: false,
        durationMs: Date.now() - start,
        blockingReason: (error.stderr ?? 'Import check failed').slice(0, 300),
      };
    } finally {
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    }
  }

  async verifyTests(filePath: string, code: string): Promise<CheckResult> {
    return runPytestForFile(filePath, code);
  }

  generateDiff(original: string, transformed: string): string {
    return generateUnifiedDiff('file.py', original, transformed);
  }

  async buildImportGraph(projectRoot: string): Promise<ImportGraph> {
    return buildPythonImportGraph(projectRoot);
  }

  async buildCallGraph(files: string[]): Promise<CallGraph> {
    return buildPythonCallGraph(files);
  }
}
