// tests/unit/backup.test.ts
import { describe, it, expect } from 'vitest';
import { BackupManager } from '../../src/infrastructure/backup.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('BackupManager', () => {
  it('backs up a file and can restore it', async () => {
    const tmpDir = path.join(os.tmpdir(), `refactron-backup-test-${Date.now()}`);
    await fs.mkdir(tmpDir, { recursive: true });

    const original = path.join(tmpDir, 'test.py');
    await fs.writeFile(original, 'original content');

    const manager = new BackupManager(tmpDir);
    const sessionId = await manager.backup(original);

    // Modify the file
    await fs.writeFile(original, 'modified content');

    // Rollback
    await manager.restore(sessionId, original);
    const content = await fs.readFile(original, 'utf-8');
    expect(content).toBe('original content');

    await fs.rm(tmpDir, { recursive: true });
  });

  it('listSessions returns empty array when no backups exist', async () => {
    const tmpDir = path.join(os.tmpdir(), `refactron-backup-test-${Date.now()}`);
    const manager = new BackupManager(tmpDir);
    const sessions = await manager.listSessions();
    expect(sessions).toEqual([]);
  });
});
