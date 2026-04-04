// src/infrastructure/backup.ts
import fs from 'fs/promises';
import path from 'path';
import { randomBytes } from 'crypto';
import { atomicWrite } from '../verification/atomic-writer.js';

export class BackupManager {
  private backupDir: string;

  constructor(projectRoot: string) {
    this.backupDir = path.join(projectRoot, '.refactron', 'backups');
  }

  async backup(filePath: string): Promise<string> {
    const sessionId = randomBytes(8).toString('hex');
    const sessionDir = path.join(this.backupDir, sessionId);
    await fs.mkdir(sessionDir, { recursive: true });

    const content = await fs.readFile(filePath, 'utf-8');
    const backupPath = path.join(sessionDir, path.basename(filePath));
    await atomicWrite(backupPath, content);

    const meta = {
      originalPath: filePath,
      backupPath,
      timestamp: new Date().toISOString(),
    };
    await atomicWrite(path.join(sessionDir, 'meta.json'), JSON.stringify(meta, null, 2));

    return sessionId;
  }

  async restore(sessionId: string, filePath: string): Promise<void> {
    const sessionDir = path.join(this.backupDir, sessionId);
    const backupPath = path.join(sessionDir, path.basename(filePath));
    const content = await fs.readFile(backupPath, 'utf-8');
    await atomicWrite(filePath, content);
  }

  async listSessions(): Promise<string[]> {
    try {
      return await fs.readdir(this.backupDir);
    } catch {
      return [];
    }
  }
}
