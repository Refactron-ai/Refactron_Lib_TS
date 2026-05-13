// tests/integration/runner-output.test.ts
// Drives `executeCommand` against the python-legacy-mini fixture and asserts
// the redesigned analyze + run --dry-run + run --apply output streams contain
// the new structural elements (per-file headers, transform names, gate-
// progress lines, atomic-write list, Summary blocks).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { executeCommand } from '../../src/cli/runner.js';
import type { CommandContext } from '../../src/cli/runner.js';
import type { WorkSession, WorkSessionAnalysis } from '../../src/session/types.js';

const SRC_FIXTURE = path.resolve('fixtures/python-legacy-mini');

describe('redesigned runner output streams', () => {
  let prevToken: string | undefined;
  let scratch: string;

  beforeAll(async () => {
    prevToken = process.env.REFACTRON_TOKEN;
    process.env.REFACTRON_TOKEN = 'sk_test_integration';
    // Copy the fixture into a scratch dir so `run --apply` can mutate freely.
    scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'refactron-runner-output-'));
    await fs.cp(SRC_FIXTURE, scratch, { recursive: true });
  }, 30_000);

  afterAll(async () => {
    if (prevToken === undefined) delete process.env.REFACTRON_TOKEN;
    else process.env.REFACTRON_TOKEN = prevToken;
    if (scratch) {
      await fs.rm(scratch, { recursive: true, force: true });
    }
  });

  it('analyze emits per-file headers, transform names, suggestions, and a Summary block', async () => {
    const lines: string[] = [];
    const { ctx } = makeFakeContext(scratch);
    await executeCommand(
      { command: 'analyze', target: scratch, flags: {} },
      ctx,
      (line: string) => lines.push(line),
      new AbortController().signal,
    );
    const text = lines.join('\n');
    // At least one fixture file appears as a per-file header.
    expect(text).toMatch(/formatting\.py|callbacks\.py|legacy_http\.py|models\.py/);
    // Transform ids should be visible in the body.
    expect(text).toMatch(/format_to_fstring|callback_to_async_await|class_to_dataclass/);
    // Per-finding suggestion line marker from format-analysis.
    expect(text).toContain('suggestion:');
    // Summary block.
    expect(text).toContain('Summary');
    expect(text).toMatch(/Files affected\s+\d+/);
  }, 60_000);

  it('run --dry-run emits per-file unified diffs with +/- markers and a Summary block', async () => {
    const { ctx } = makeFakeContext(scratch);
    // First run analyze to populate the session that `run` requires.
    await executeCommand(
      { command: 'analyze', target: scratch, flags: {} },
      ctx,
      () => undefined,
      new AbortController().signal,
    );
    const lines: string[] = [];
    await executeCommand(
      { command: 'run', target: '.', flags: {} },
      ctx,
      (line: string) => lines.push(line),
      new AbortController().signal,
    );
    const text = lines.join('\n');
    // Unified-diff hunks contain `@@`.
    expect(text).toContain('@@');
    // At least one `+`-prefixed body line and one `-`-prefixed body line.
    // We look for the leading whitespace + +/- pattern the formatter emits.
    expect(text).toMatch(/^\s+\+[^+]/m);
    expect(text).toMatch(/^\s+-[^-]/m);
    // Summary block from format-plan.
    expect(text).toContain('Summary');
    expect(text).toMatch(/Files\s+\d+/);
    expect(text).toMatch(/\+\d+ \/ -\d+/);
    expect(text).toContain('Nothing has been written');
  }, 60_000);

  it('run --apply streams gate-progress lines and atomic-write list on success', async () => {
    // Use a SEPARATE scratch so we don't depend on whether the previous test
    // already mutated state. python-legacy-mini's test suite is the gate.
    const applyScratch = await fs.mkdtemp(path.join(os.tmpdir(), 'refactron-apply-out-'));
    try {
      await fs.cp(SRC_FIXTURE, applyScratch, { recursive: true });
      const { ctx } = makeFakeContext(applyScratch);
      // Populate session.
      await executeCommand(
        { command: 'analyze', target: applyScratch, flags: {} },
        ctx,
        () => undefined,
        new AbortController().signal,
      );
      const lines: string[] = [];
      await executeCommand(
        { command: 'run', target: '.', flags: { apply: true } },
        ctx,
        (line: string) => lines.push(line),
        new AbortController().signal,
      );
      const text = lines.join('\n');
      // Gate-progress lines from format-verify.
      expect(text).toMatch(/syntax/i);
      expect(text).toMatch(/imports/i);
      expect(text).toMatch(/tests/i);
      // On success we expect either the success-block header or per-file
      // atomic-write entries with transform tags.
      expect(text).toMatch(/written|applied|verified|Gate/i);
    } finally {
      await fs.rm(applyScratch, { recursive: true, force: true });
    }
  }, 180_000);
});

function makeFakeContext(projectRoot: string): { ctx: CommandContext } {
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
    updateActive(
      updates: Partial<Pick<WorkSession, 'phase' | 'fix' | 'verify'>>,
    ): WorkSession | null {
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
    adapter: {} as CommandContext['adapter'],
    config: {} as CommandContext['config'],
    sessions: fakeSessions as unknown as CommandContext['sessions'],
  } satisfies CommandContext;

  return { ctx };
}
