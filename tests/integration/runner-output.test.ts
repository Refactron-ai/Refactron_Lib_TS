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
    // TRANSFORMS legend table from format-analysis (per-transform guidance).
    expect(text).toContain('TRANSFORMS');
    // SUMMARY box.
    expect(text).toContain('SUMMARY');
    expect(text).toMatch(/Files affected.+\d/);
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
    // At least one `+`-prefixed and one `-`-prefixed body line. Each diff line
    // sits inside the per-file box, so it reads `│ +…` / `│ -…`.
    expect(text).toMatch(/│ \+[^+]/m);
    expect(text).toMatch(/│ -[^-]/m);
    // SUMMARY box from format-plan.
    expect(text).toContain('SUMMARY');
    expect(text).toMatch(/Files.+\d/);
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

describe('REPL document target picks the active session, not ctx.projectRoot', () => {
  let prevToken: string | undefined;
  let prevMock: string | undefined;
  let oldProject: string;
  let newProject: string;

  beforeAll(async () => {
    prevToken = process.env.REFACTRON_TOKEN;
    prevMock = process.env.REFACTRON_DOCUMENT_MOCK;
    process.env.REFACTRON_TOKEN = 'sk_test_integration';
    process.env.REFACTRON_DOCUMENT_MOCK = '1'; // deterministic provider
    oldProject = await fs.mkdtemp(path.join(os.tmpdir(), 'refactron-doctgt-old-'));
    newProject = await fs.mkdtemp(path.join(os.tmpdir(), 'refactron-doctgt-new-'));
    // Stale snapshot in the old project (looks like a stale TS apply).
    const oldFile = path.join(oldProject, 'stale-vars.ts');
    await fs.writeFile(oldFile, 'export function staleSym() {\n  return 1;\n}\n');
    await fs.mkdir(path.join(oldProject, '.refactron'), { recursive: true });
    await fs.writeFile(
      path.join(oldProject, '.refactron', 'last-apply.json'),
      JSON.stringify({
        projectRoot: oldProject,
        verifiedAt: new Date(0).toISOString(),
        changes: [
          {
            path: oldFile,
            oldContent: 'export function staleSym() {\n  return 1;\n}\n',
            newContent: 'export function staleSym() {\n  return 2;\n}\n',
            transformId: 'var_to_const_let',
          },
        ],
      }),
    );
    // Fresh snapshot in the new project (the one the user just refactored).
    const newFile = path.join(newProject, 'fresh.py');
    await fs.writeFile(newFile, 'def freshSym():\n    return 2\n');
    await fs.mkdir(path.join(newProject, '.refactron'), { recursive: true });
    await fs.writeFile(
      path.join(newProject, '.refactron', 'last-apply.json'),
      JSON.stringify({
        projectRoot: newProject,
        verifiedAt: new Date().toISOString(),
        changes: [
          {
            path: newFile,
            oldContent: 'def freshSym():\n    return 1\n',
            newContent: 'def freshSym():\n    return 2\n',
            transformId: 'format_to_fstring',
          },
        ],
      }),
    );
  }, 30_000);

  afterAll(async () => {
    if (prevToken === undefined) delete process.env.REFACTRON_TOKEN;
    else process.env.REFACTRON_TOKEN = prevToken;
    if (prevMock === undefined) delete process.env.REFACTRON_DOCUMENT_MOCK;
    else process.env.REFACTRON_DOCUMENT_MOCK = prevMock;
    if (oldProject) await fs.rm(oldProject, { recursive: true, force: true });
    if (newProject) await fs.rm(newProject, { recursive: true, force: true });
  });

  it('reads last-apply.json from the active session, not from ctx.projectRoot', async () => {
    // ctx.projectRoot points at the OLD project (stale snapshot).
    // Active session's analysis.target points at the NEW project.
    // `document` without an explicit path must read NEW, not OLD.
    const lines: string[] = [];
    const { ctx } = makeFakeContext(oldProject);
    const fakeAnalysis: WorkSessionAnalysis = {
      target: newProject,
      filesAnalyzed: 1,
      filesSkipped: 0,
      totalIssues: 1,
      fixableCount: 1,
      issuesBySeverity: { critical: 0, high: 1, medium: 0, low: 0 },
      issues: [],
      durationMs: 1,
      timestamp: new Date().toISOString(),
    };
    const session = ctx.sessions.createSession(fakeAnalysis);
    ctx.sessions.setActive(session);

    await executeCommand(
      { command: 'document', target: '.', flags: {} },
      ctx,
      (line: string) => lines.push(line),
      new AbortController().signal,
    );
    const text = lines.join('\n');
    // We loaded the fresh snapshot — the freshSym symbol from the new project
    // shows up in the dry-run output. The stale staleSym symbol from the old
    // project must NOT appear (would mean we read the wrong snapshot).
    expect(text).toMatch(/freshSym/);
    expect(text).not.toMatch(/staleSym/);
  }, 30_000);
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
