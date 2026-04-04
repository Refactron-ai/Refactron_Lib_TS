// src/pipeline/session.ts
import type { PipelineSession, SessionState, Severity, FixQueueItem } from '../core/models.js';
import { randomBytes } from 'crypto';

export class SessionManager {
  createSession(target: string, totalFiles: number): PipelineSession {
    return {
      sessionId: randomBytes(8).toString('hex'),
      target,
      state: 'ANALYZED',
      totalFiles,
      totalIssues: 0,
      issuesBySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
      fixQueue: [],
      appliedFixes: [],
      blockedFixes: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  transition(session: PipelineSession, state: SessionState): PipelineSession {
    return { ...session, state, updatedAt: new Date() };
  }

  recordIssues(
    session: PipelineSession,
    count: number,
    bySeverity: Record<Severity, number>,
  ): PipelineSession {
    return { ...session, totalIssues: count, issuesBySeverity: bySeverity, updatedAt: new Date() };
  }

  recordFix(session: PipelineSession, item: FixQueueItem, applied: boolean): PipelineSession {
    const updated = { ...session, updatedAt: new Date() };
    if (applied) {
      updated.appliedFixes = [...session.appliedFixes, item];
    } else {
      updated.blockedFixes = [...session.blockedFixes, item];
    }
    return updated;
  }
}
