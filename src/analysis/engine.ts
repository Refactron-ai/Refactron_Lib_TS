// src/analysis/engine.ts
import fs from 'fs/promises';
import path from 'path';
import { glob } from 'glob';
import type { AnalysisResult, CodeIssue } from '../core/models.js';
import type { RefactronConfig, AnalyzerConfig } from '../core/config.js';
import type { ILanguageAdapter } from '../adapters/interface.js';
import { BlastRadiusAnalyzer } from './blast-radius.js';
import { TemporalAnalyzer } from './temporal.js';
import { SecurityAnalyzer } from './analyzers/security.js';
import { ComplexityAnalyzer } from './analyzers/complexity.js';
import { CodeSmellAnalyzer } from './analyzers/code-smell.js';
import { DeadCodeAnalyzer } from './analyzers/dead-code.js';
import { TypeHintsAnalyzer } from './analyzers/type-hints.js';
import { DependenciesAnalyzer } from './analyzers/dependencies.js';
import { PerformanceAnalyzer } from './analyzers/performance.js';
import type { BaseAnalyzer } from './analyzers/base.js';

export class AnalysisEngine {
  private analyzers: BaseAnalyzer[] = [
    new SecurityAnalyzer(),
    new ComplexityAnalyzer(),
    new CodeSmellAnalyzer(),
    new DeadCodeAnalyzer(),
    new TypeHintsAnalyzer(),
    new DependenciesAnalyzer(),
    new PerformanceAnalyzer(),
  ];

  constructor(
    private adapter: ILanguageAdapter,
    private config: RefactronConfig,
  ) {}

  async analyze(target: string): Promise<AnalysisResult> {
    const start = Date.now();
    const files = await this.findFiles(target);

    // Build graphs once upfront (not per-file)
    const [importGraph, callGraph] = await Promise.all([
      this.adapter.buildImportGraph(target),
      this.adapter.buildCallGraph(files),
    ]);
    const blastAnalyzer = new BlastRadiusAnalyzer(callGraph, importGraph);

    // Build temporal profiles in one batch pass (one git call per file max)
    const temporalAnalyzer = new TemporalAnalyzer();
    const temporalCache = new Map<string, Awaited<ReturnType<TemporalAnalyzer['profile']>>>();
    await Promise.all(
      files.map(async (f) => {
        const t = await temporalAnalyzer.profile(f);
        temporalCache.set(f, t);
      }),
    );

    const allIssues: CodeIssue[] = [];
    let filesSkipped = 0;

    for (const filePath of files) {
      let code: string;
      try {
        code = await fs.readFile(filePath, 'utf-8');
      } catch {
        filesSkipped++;
        continue;
      }

      const blastRadius = blastAnalyzer.compute(filePath);
      const temporal = temporalCache.get(filePath) ?? null;

      for (const analyzer of this.analyzers) {
        const analyzerKey = analyzer.name as keyof RefactronConfig['analyzers'];
        const analyzerCfg = this.config.analyzers[analyzerKey];
        if (!analyzerCfg?.enabled) continue;

        const result = await analyzer.analyze(filePath, code, analyzerCfg as AnalyzerConfig);

        for (const partialIssue of result.issues) {
          allIssues.push({
            ...partialIssue,
            blastRadius,
            ...(temporal ? { temporal } : {}),
          });
        }
      }
    }

    // Adapter-level additional analysis
    const adapterIssues = await this.adapter.analyze(files);
    for (const issue of adapterIssues) {
      if (!issue.blastRadius) {
        allIssues.push({ ...issue, blastRadius: blastAnalyzer.compute(issue.file) });
      } else {
        allIssues.push(issue);
      }
    }

    const languageBreakdown: Record<string, number> = {};
    for (const file of files) {
      const ext = path.extname(file);
      languageBreakdown[ext] = (languageBreakdown[ext] ?? 0) + 1;
    }

    return {
      target,
      filesAnalyzed: files.length - filesSkipped,
      filesSkipped,
      issues: allIssues,
      languageBreakdown,
      durationMs: Date.now() - start,
      timestamp: new Date(),
    };
  }

  private async findFiles(target: string): Promise<string[]> {
    // Single file
    try {
      const stat = await fs.stat(target);
      if (stat.isFile()) return [target];
    } catch {
      return []; // target doesn't exist
    }

    const exts = this.adapter.extensions.map((e) => e.replace(/^\./, ''));
    // Use brace expansion only when >1 extension — {single} can behave unexpectedly
    const pattern = exts.length === 1 ? `**/*.${exts[0]}` : `**/*.{${exts.join(',')}}`;

    const files = await glob(pattern, {
      cwd: target,
      ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/.refactron/**'],
      absolute: true,
    });

    return files.sort(); // stable order across runs
  }
}
