// tests/integration/repl-v2.test.ts
// REPL v2 integration: drives runner.executeCommand directly with a synthetic
// CommandContext so we exercise the analyze pipeline end-to-end without the
// React/Ink layer.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'node:path';
import { executeCommand } from '../../src/cli/runner.js';
import type { CommandContext } from '../../src/cli/runner.js';
import type { WorkSession, WorkSessionAnalysis } from '../../src/session/types.js';

const FIXTURE = path.resolve('fixtures/python-legacy-mini');

describe('REPL v2 execution', () => {
  let prevToken: string | undefined;

  beforeAll(() => {
    // Bypass auth gate via env credentials (see src/auth/credentials.ts).
    prevToken = process.env.REFACTRON_TOKEN;
    process.env.REFACTRON_TOKEN = 'sk_test_integration';
  });

  afterAll(() => {
    if (prevToken === undefined) delete process.env.REFACTRON_TOKEN;
    else process.env.REFACTRON_TOKEN = prevToken;
  });

  it('analyze populates a session and signals openBrowser=true', async () => {
    const lines: string[] = [];
    const { ctx, getActive } = makeFakeContext(FIXTURE);
    const result = await executeCommand(
      { command: 'analyze', target: FIXTURE, flags: {} },
      ctx,
      (line: string) => lines.push(line),
      new AbortController().signal,
    );

    expect(result.openBrowser).toBe(true);
    const active = getActive();
    expect(active).toBeTruthy();
    expect(active!.analysis.issues.length).toBeGreaterThan(0);
  }, 60_000);
});

function makeFakeContext(projectRoot: string): {
  ctx: CommandContext;
  getActive: () => WorkSession | null;
} {
  const store = new Map<string, WorkSession>();
  let activeId: string | null = null;

  const fakeSessions = {
    createSession(payload: WorkSessionAnalysis): WorkSession {
      const id = `s${Date.now()}${Math.floor(Math.random() * 1000)}`;
      const now = new Date().toISOString();
      const session: WorkSession = {
        id,
        analysis: payload,
        phase: 'analyzed',
        createdAt: now,
        updatedAt: now,
      };
      store.set(id, session);
      return session;
    },
    setActive(s: WorkSession): void {
      activeId = s.id;
      store.set(s.id, s);
    },
    getActive(): WorkSession | null {
      return activeId ? (store.get(activeId) ?? null) : null;
    },
    clearActive(): void {
      activeId = null;
    },
    updateActive(updates: Partial<Pick<WorkSession, 'phase' | 'fix' | 'verify'>>): WorkSession | null {
      if (!activeId) return null;
      const existing = store.get(activeId);
      if (!existing) return null;
      const updated: WorkSession = {
        ...existing,
        ...updates,
        updatedAt: new Date().toISOString(),
      };
      store.set(updated.id, updated);
      return updated;
    },
    async save(s: WorkSession): Promise<void> {
      store.set(s.id, s);
    },
    async load(id: string): Promise<WorkSession | null> {
      return store.get(id) ?? null;
    },
    async list(): Promise<WorkSession[]> {
      return [...store.values()];
    },
    async latest(): Promise<WorkSession | null> {
      const all = [...store.values()];
      if (all.length === 0) return null;
      return all[all.length - 1] ?? null;
    },
  };

  const ctx = {
    projectRoot,
    // Minimal stubs — the v2 analyze handler does not consult these, but the
    // CommandContext interface requires them.
    adapter: {} as CommandContext['adapter'],
    config: {} as CommandContext['config'],
    sessions: fakeSessions as unknown as CommandContext['sessions'],
  } satisfies CommandContext;

  return { ctx, getActive: () => fakeSessions.getActive() };
}
