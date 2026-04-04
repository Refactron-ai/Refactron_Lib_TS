// src/pipeline/store.ts
import type { PipelineSession } from '../core/models.js';
import { atomicWrite } from '../verification/atomic-writer.js';
import fs from 'fs/promises';
import path from 'path';

export class SessionStore {
  private sessionsDir: string;

  constructor(projectRoot: string) {
    this.sessionsDir = path.join(projectRoot, '.refactron', 'sessions');
  }

  async save(session: PipelineSession): Promise<void> {
    await fs.mkdir(this.sessionsDir, { recursive: true });
    const filePath = path.join(this.sessionsDir, `${session.sessionId}.json`);
    await atomicWrite(filePath, JSON.stringify(session, null, 2));
  }

  async load(sessionId: string): Promise<PipelineSession | null> {
    try {
      const filePath = path.join(this.sessionsDir, `${sessionId}.json`);
      const raw = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(raw) as PipelineSession;
    } catch {
      return null;
    }
  }

  async latest(): Promise<PipelineSession | null> {
    try {
      const files = await fs.readdir(this.sessionsDir);
      const jsonFiles = files.filter((f) => f.endsWith('.json'));
      if (jsonFiles.length === 0) return null;
      jsonFiles.sort().reverse();
      return this.load(jsonFiles[0]!.replace('.json', ''));
    } catch {
      return null;
    }
  }

  async list(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.sessionsDir);
      return files.filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));
    } catch {
      return [];
    }
  }
}
