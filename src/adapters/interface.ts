// src/adapters/interface.ts
// LOCKED. Do not change after initial commit.

import type { CodeIssue, CheckResult } from '../core/models.js';

export interface ImportGraph {
  dependentsOf(file: string): string[];
  dependenciesOf(file: string): string[];
  allFiles(): string[];
}

export interface CallGraph {
  transitiveCallersOf(file: string, fn: string): string[];
  allPublicFunctionsIn(files: string[]): string[];
}

export interface TransformResult {
  transformedCode: string;
  description: string;
  riskLevel: 'low' | 'medium' | 'high';
}

export interface ILanguageAdapter {
  // Identity
  readonly name: string; // 'python', 'typescript'
  readonly extensions: string[]; // ['.py'], ['.ts', '.tsx']
  readonly displayName: string; // 'Python', 'TypeScript'

  // Detection
  detect(projectRoot: string): Promise<boolean>;

  // Analysis — must return issues WITH blastRadius populated
  analyze(files: string[]): Promise<CodeIssue[]>;

  // Transform (in-memory — no write)
  transform(file: string, code: string, issue: CodeIssue): Promise<TransformResult>;

  // Verification checks
  verifySyntax(path: string, code: string): Promise<CheckResult>;
  verifyImports(path: string, code: string): Promise<CheckResult>;
  verifyTests(path: string, code: string): Promise<CheckResult>;

  // Diff
  generateDiff(original: string, transformed: string): string;

  // Graphs (for blast radius)
  buildImportGraph(projectRoot: string): Promise<ImportGraph>;
  buildCallGraph(files: string[]): Promise<CallGraph>;
}
