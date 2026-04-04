// src/session/manager.ts
// WorkSessionManager — creates, persists, loads and tracks the active WorkSession.
// Sessions live at .refactron/work-sessions/{id}.json
import fs from 'fs/promises';
import path from 'path';
import { randomBytes } from 'crypto';
import { atomicWrite } from '../verification/atomic-writer.js';
import type { WorkSession, WorkSessionAnalysis } from './types.js';

export class WorkSessionManager {
  private sessionsDir: string;
  private activeSession: WorkSession | null = null;

  constructor(projectRoot: string) {
    this.sessionsDir = path.join(projectRoot, '.refactron', 'work-sessions');
  }

  // ── Create ──────────────────────────────────────────────────────────────

  createSession(analysis: WorkSessionAnalysis): WorkSession {
    const now = new Date().toISOString();
    return {
      id: randomBytes(6).toString('hex'),
      phase: 'analyzed',
      analysis,
      createdAt: now,
      updatedAt: now,
    };
  }

  // ── Active session ───────────────────────────────────────────────────────

  getActive(): WorkSession | null {
    return this.activeSession;
  }

  setActive(session: WorkSession): void {
    this.activeSession = session;
  }

  clearActive(): void {
    this.activeSession = null;
  }

  updateActive(
    updates: Partial<Pick<WorkSession, 'phase' | 'fix' | 'verify'>>,
  ): WorkSession | null {
    if (!this.activeSession) return null;
    this.activeSession = {
      ...this.activeSession,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    return this.activeSession;
  }

  // ── Persistence ──────────────────────────────────────────────────────────

  async save(session: WorkSession): Promise<void> {
    await fs.mkdir(this.sessionsDir, { recursive: true });
    const filePath = path.join(this.sessionsDir, `${session.id}.json`);
    await atomicWrite(filePath, JSON.stringify(session, null, 2));
  }

  async load(id: string): Promise<WorkSession | null> {
    try {
      const filePath = path.join(this.sessionsDir, `${id}.json`);
      const raw = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(raw) as WorkSession;
    } catch {
      return null;
    }
  }

  async latest(): Promise<WorkSession | null> {
    try {
      const files = await fs.readdir(this.sessionsDir);
      const ids = files.filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));
      if (ids.length === 0) return null;
      ids.sort().reverse();
      return this.load(ids[0]!);
    } catch {
      return null;
    }
  }

  async list(): Promise<WorkSession[]> {
    try {
      const files = await fs.readdir(this.sessionsDir);
      const ids = files.filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));
      ids.sort().reverse();
      const sessions = await Promise.all(ids.map((id) => this.load(id)));
      return sessions.filter((s): s is WorkSession => s !== null);
    } catch {
      return [];
    }
  }

  async saveActive(): Promise<void> {
    if (this.activeSession) await this.save(this.activeSession);
  }
}
