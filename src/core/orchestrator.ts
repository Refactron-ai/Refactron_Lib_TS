// src/core/orchestrator.ts
import type { AnalysisResult, PipelineSession, Severity } from './models.js';
import type { RefactronConfig } from './config.js';
import type { ILanguageAdapter } from '../adapters/interface.js';
import { AnalysisEngine } from '../analysis/engine.js';
import { AutoFixEngine } from '../autofix/engine.js';
import { VerificationEngine } from '../verification/engine.js';
import { BackupManager } from '../infrastructure/backup.js';
import { atomicWrite } from '../verification/atomic-writer.js';
import { SessionManager } from '../pipeline/session.js';
import { SessionStore } from '../pipeline/store.js';
import { FixQueue } from '../pipeline/queue.js';
import fs from 'fs/promises';

export interface OrchestratorResult {
  session: PipelineSession;
  analysis: AnalysisResult;
}

export class Orchestrator {
  private analysisEngine: AnalysisEngine;
  private autofixEngine: AutoFixEngine;
  private verificationEngine: VerificationEngine;
  private backupManager: BackupManager;
  private sessionManager: SessionManager;
  private store: SessionStore;

  constructor(
    private adapter: ILanguageAdapter,
    private config: RefactronConfig,
    private projectRoot: string,
  ) {
    this.analysisEngine = new AnalysisEngine(adapter, config);
    this.autofixEngine = new AutoFixEngine();
    this.verificationEngine = new VerificationEngine(adapter);
    this.backupManager = new BackupManager(projectRoot);
    this.sessionManager = new SessionManager();
    this.store = new SessionStore(projectRoot);
  }

  async analyze(target: string): Promise<OrchestratorResult> {
    const analysis = await this.analysisEngine.analyze(target);

    const bySeverity: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const issue of analysis.issues) {
      bySeverity[issue.severity]++;
    }

    let session = this.sessionManager.createSession(target, analysis.filesAnalyzed);
    session = this.sessionManager.recordIssues(session, analysis.issues.length, bySeverity);
    await this.store.save(session);

    return { session, analysis };
  }

  async autofix(
    target: string,
    options: { dryRun?: boolean; verify?: boolean } = {},
  ): Promise<{ session: PipelineSession; analysis: AnalysisResult }> {
    const { analysis } = await this.analyze(target);
    const session = await this._runFixes(analysis, options);
    return { session, analysis };
  }

  // Skip re-analysis — use a previously computed AnalysisResult directly.
  async autofixFromAnalysis(
    analysis: AnalysisResult,
    options: { dryRun?: boolean; verify?: boolean } = {},
  ): Promise<PipelineSession> {
    return this._runFixes(analysis, options);
  }

  private async _runFixes(
    analysis: AnalysisResult,
    options: { dryRun?: boolean; verify?: boolean } = {},
  ): Promise<PipelineSession> {
    const bySeverity: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const issue of analysis.issues) bySeverity[issue.severity]++;

    let session = this.sessionManager.createSession(analysis.target, analysis.filesAnalyzed);
    session = this.sessionManager.recordIssues(session, analysis.issues.length, bySeverity);
    session = this.sessionManager.transition(session, 'FIXING');
    const queue = new FixQueue();

    for (const issue of analysis.issues) {
      if (this.autofixEngine.canFix(issue)) {
        queue.enqueue(issue, issue.fixerName ?? '');
      }
    }

    for (const queueItem of queue.getPending()) {
      const issue = analysis.issues.find((i) => i.id === queueItem.issueId);
      if (!issue) continue;

      const originalCode = await fs.readFile(issue.file, 'utf-8');
      const transform = await this.autofixEngine.fix(issue.file, originalCode, issue);
      if (!transform) continue;

      if (options.verify ?? this.config.autofix.require_verification) {
        const verResult = await this.verificationEngine.verify(
          issue.file,
          transform.transformedCode,
          issue.blastRadius,
        );

        if (!verResult.safeToApply) {
          const extra: { verificationResult: typeof verResult; blockReason?: string } = {
            verificationResult: verResult,
          };
          if (verResult.blockingReason !== undefined) {
            extra.blockReason = verResult.blockingReason;
          }
          queue.updateStatus(queueItem.issueId, 'BLOCKED', extra);
          session = this.sessionManager.recordFix(session, queueItem, false);
          continue;
        }
      }

      if (!options.dryRun) {
        await this.backupManager.backup(issue.file);
        await atomicWrite(issue.file, transform.transformedCode);
        queue.updateStatus(queueItem.issueId, 'APPLIED', {
          diff: this.adapter.generateDiff(originalCode, transform.transformedCode),
        });
        session = this.sessionManager.recordFix(session, { ...queueItem, status: 'APPLIED' }, true);
      }
    }

    session = this.sessionManager.transition(session, 'FIXED');
    await this.store.save(session);
    return session;
  }
}
