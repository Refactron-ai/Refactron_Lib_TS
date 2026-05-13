// src/cli/runner.ts
// Command execution engine — runs a parsed command, streams output lines via onLine()
import path from 'path';
import type { ILanguageAdapter } from '../adapters/interface.js';
import type { RefactronConfig } from '../core/config.js';
import type { AnalysisResult, Severity } from '../core/models.js';
import { RefactronAnalyzer } from '../analyze/engine.js';
import { RefactronRefactorer } from '../transform/engine.js';
import { RefactronVerifier } from '../verify/engine.js';
import { writeBatchAtomic } from '../verify/atomic-batch-writer.js';
import type { TransformId } from '../contracts.js';
import { findingsToIssues } from './v2-adapters.js';
import { persistLastApply } from './last-apply.js';
import * as fsp from 'node:fs/promises';
import { WorkSessionManager } from '../session/manager.js';
import type { WorkSession } from '../session/types.js';
import { theme } from '../ui/theme.js';
import {
  loadCredentials,
  deleteCredentials,
  isAuthenticated,
  runLoginFlow,
} from '../auth/index.js';

// Commands that never require auth
const AUTH_EXEMPT = new Set([
  'login',
  'logout',
  'auth',
  'help',
  '?',
  'clear',
  'exit',
  'quit',
  'q',
  'session',
  '',
]);

export interface CommandContext {
  adapter: ILanguageAdapter;
  config: RefactronConfig;
  projectRoot: string;
  sessions: WorkSessionManager; // owns active session across all REPL commands
}

export interface ParsedCommand {
  command: string;
  target: string;
  flags: Record<string, boolean | string>;
}

export function parseInput(raw: string): ParsedCommand {
  const parts = raw.trim().split(/\s+/);
  // Strip leading '/' so /analyze, /help, etc. work like their bare forms
  const command = (parts[0] ?? '').replace(/^\//, '');
  let target = '.';
  const flags: Record<string, boolean | string> = {};

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i] ?? '';
    if (part.startsWith('--')) {
      const next = parts[i + 1];
      if (next && !next.startsWith('--')) {
        flags[part.slice(2)] = next;
        i++;
      } else {
        flags[part.slice(2)] = true;
      }
    } else {
      target = part;
    }
  }

  return { command, target, flags };
}

// ── Formatters ──────────────────────────────────────────────────────────────

function severityColor(s: Severity): string {
  return theme.severityColors[s];
}

function blastBadge(level: string): string {
  const map: Record<string, string> = {
    trivial: 'trivial',
    low: 'low',
    medium: 'med',
    high: 'HIGH',
    critical: 'CRIT',
  };
  return map[level] ?? level;
}

function formatAnalysis(
  result: AnalysisResult,
  onLine: (line: string, color?: string) => void,
): void {
  const bySeverity: Record<Severity, typeof result.issues> = {
    critical: [],
    high: [],
    medium: [],
    low: [],
  };
  for (const issue of result.issues) bySeverity[issue.severity].push(issue);

  for (const sev of ['critical', 'high', 'medium', 'low'] as Severity[]) {
    const group = bySeverity[sev];
    if (group.length === 0) continue;
    onLine('', undefined);
    onLine(`  ${sev.toUpperCase()} (${group.length})`, severityColor(sev));
    for (const issue of group.slice(0, 20)) {
      const blast = blastBadge(issue.blastRadius.level);
      const file = issue.file.split('/').slice(-2).join('/');
      const fixTag = issue.fixable ? ' [fixable]' : '';
      onLine(
        `  ${theme.symbols.bullet} ${issue.message.slice(0, 55).padEnd(57)} ${file}:${issue.line}  blast:${blast}${fixTag}`,
        theme.colors.text,
      );
    }
    if (group.length > 20) onLine(`    … and ${group.length - 20} more`, theme.colors.textDim);
  }

  onLine('', undefined);
  const fixable = result.issues.filter((i) => i.fixable).length;
  const {
    critical: c,
    high: h,
    medium: m,
    low: l,
  } = {
    critical: bySeverity.critical.length,
    high: bySeverity.high.length,
    medium: bySeverity.medium.length,
    low: bySeverity.low.length,
  };
  onLine(
    `  ${c} critical  ${h} high  ${m} medium  ${l} low  —  ${fixable} fixable  |  ${result.filesAnalyzed} files  ${result.durationMs}ms`,
    c > 0 ? theme.colors.critical : h > 0 ? theme.colors.high : theme.colors.textDim,
  );
}

function printSessionCard(
  session: WorkSession,
  projectRoot: string,
  onLine: (line: string, color?: string) => void,
): void {
  const rel = path.relative(projectRoot, session.analysis.target) || '.';
  const age = new Date(session.createdAt).toLocaleString();
  onLine('', undefined);
  onLine(`  Session  ${session.id}`, theme.colors.brand);
  onLine(`  Target   ${rel}`, theme.colors.text);
  onLine(`  Phase    ${session.phase}`, theme.colors.textDim);
  onLine(
    `  Issues   ${session.analysis.totalIssues}  (${session.analysis.fixableCount} fixable)`,
    theme.colors.text,
  );
  onLine(`  Files    ${session.analysis.filesAnalyzed}  scanned`, theme.colors.textDim);
  onLine(`  Created  ${age}`, theme.colors.textDim);
  if (session.fix) {
    onLine(
      `  Fix      ${session.fix.appliedCount} applied  ${session.fix.blockedCount} blocked${session.fix.dryRun ? '  [dry-run]' : ''}`,
      theme.colors.text,
    );
  }
  if (session.verify) {
    onLine(
      `  Verify   ${session.verify.passed} passed  ${session.verify.blocked} blocked`,
      theme.colors.text,
    );
  }
  onLine('', undefined);
}

// ── Main executor ────────────────────────────────────────────────────────────

export interface CommandResult {
  shouldExit?: boolean;
}

export async function executeCommand(
  parsed: ParsedCommand,
  ctx: CommandContext,
  onLine: (line: string, color?: string) => void,
  signal: AbortSignal,
): Promise<CommandResult> {
  const { command, target, flags } = parsed;
  const absTarget = path.resolve(target);

  // ── Auth commands ────────────────────────────────────────────────────────

  if (command === 'login') {
    const noBrowser = flags['no-browser'] === true;
    onLine('', undefined);
    try {
      const { creds, requiresApiKey } = await runLoginFlow(noBrowser, (msg) =>
        onLine(`  ${msg}`, theme.colors.textDim),
      );
      onLine('', undefined);
      if (requiresApiKey) {
        onLine(
          `  ${theme.symbols.pass}  OAuth complete. Run  refactron  to set your API key.`,
          theme.colors.warning,
        );
      } else {
        onLine(
          `  ${theme.symbols.pass}  Logged in as ${creds.email ?? 'unknown'} (${creds.plan ?? 'free'} plan)`,
          theme.colors.success,
        );
      }
    } catch (err) {
      onLine(`  ${theme.symbols.fail}  ${String(err)}`, theme.colors.error);
    }
    onLine('', undefined);
    return {};
  }

  if (command === 'logout') {
    await deleteCredentials();
    onLine('', undefined);
    onLine('  Logged out. Credentials removed.', theme.colors.textDim);
    onLine('  Goodbye.', theme.colors.textDim);
    onLine('', undefined);
    return { shouldExit: true };
  }

  if (command === 'auth') {
    onLine('', undefined);
    const creds = await loadCredentials();
    if (!creds || !isAuthenticated(creds)) {
      onLine('  Status     Not authenticated', theme.colors.error);
      onLine('  Run: login  to log in.', theme.colors.textDim);
    } else {
      const expiresAt = creds.expires_at ? new Date(creds.expires_at).toLocaleString() : 'never';
      onLine('  ┌─────────────────────────────────┐', theme.colors.border);
      onLine(`  │  Status    Active               │`, theme.colors.success);
      onLine(`  │  User      ${(creds.email ?? 'unknown').padEnd(21)}│`, theme.colors.text);
      onLine(
        `  │  Plan      ${(creds.plan?.toUpperCase() ?? 'FREE').padEnd(21)}│`,
        theme.colors.text,
      );
      onLine(`  │  API URL   ${creds.api_base_url.slice(8, 30).padEnd(21)}│`, theme.colors.textDim);
      onLine(`  │  Expires   ${expiresAt.slice(0, 20).padEnd(21)}│`, theme.colors.textDim);
      onLine('  └─────────────────────────────────┘', theme.colors.border);
    }
    onLine('', undefined);
    return {};
  }

  // ── Auth gate ────────────────────────────────────────────────────────────

  if (!AUTH_EXEMPT.has(command)) {
    const creds = await loadCredentials();
    if (!isAuthenticated(creds)) {
      onLine('', undefined);
      onLine(`  ${theme.symbols.fail}  Not authenticated.`, theme.colors.error);
      onLine(`  Run: login  to log in.`, theme.colors.textDim);
      onLine('', undefined);
      return {};
    }
  }

  // ── Regular commands ─────────────────────────────────────────────────────

  if (command === 'help' || command === '?') {
    onLine('', undefined);
    onLine('  Pipeline:', theme.colors.accent);
    onLine(
      '  analyze  [target]              scan project for transform patterns',
      theme.colors.text,
    );
    onLine(
      '  run      [--apply] [--transforms=<list|all>]  plan + verify + apply',
      theme.colors.text,
    );
    onLine(
      '  document [target]              generate docstrings for verified refactors (Week 6)',
      theme.colors.text,
    );
    onLine('  init     [target]              scaffold .refactronrc.json', theme.colors.text);
    onLine('', undefined);
    onLine('  Session:', theme.colors.accent);
    onLine('  status                         show active session details', theme.colors.text);
    onLine('  session list                   list all saved sessions', theme.colors.text);
    onLine('  session <id>                   load a previous session', theme.colors.text);
    onLine('  rollback                       restore from last backup', theme.colors.text);
    onLine('', undefined);
    onLine('  Auth + utilities:', theme.colors.accent);
    onLine('  login                          authenticate with Refactron', theme.colors.text);
    onLine('  logout                         remove stored credentials', theme.colors.text);
    onLine('  auth                           show auth status', theme.colors.text);
    onLine('  clear                          clear the screen', theme.colors.text);
    onLine('  exit                           quit refactron', theme.colors.text);
    onLine('', undefined);
    return {};
  }

  // ── analyze — read-only scan, prints findings, creates a session ────────
  // Each v2 verb does ONE thing. analyze never mutates anything and never
  // routes to a fix UI; use `run --dry-run` to preview changes and
  // `run --apply` to verify+write.

  if (command === 'analyze') {
    onLine(`  Scanning ${absTarget} …`, theme.colors.textDim);
    const startedAt = Date.now();
    const analyzer = new RefactronAnalyzer({ confidence: 'high' });
    const report = await analyzer.analyzeExtended(absTarget);
    if (signal.aborted) return {};

    const issues = findingsToIssues(report.findings);
    const bySeverity: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const issue of issues) bySeverity[issue.severity]++;
    const fixableCount = issues.filter((i) => i.fixable).length;
    const filesAnalyzed = report.importGraph.size;
    const durationMs = Date.now() - startedAt;

    const analysisResult: AnalysisResult = {
      target: absTarget,
      filesAnalyzed,
      filesSkipped: 0,
      issues,
      languageBreakdown: {},
      durationMs,
      timestamp: report.analyzedAt,
    };

    const session = ctx.sessions.createSession({
      target: absTarget,
      filesAnalyzed,
      filesSkipped: 0,
      totalIssues: issues.length,
      fixableCount,
      issuesBySeverity: bySeverity,
      issues,
      durationMs,
      timestamp: report.analyzedAt.toISOString(),
    });
    ctx.sessions.setActive(session);
    await ctx.sessions.save(session);

    const transformsHit = [...new Set(report.findings.map((f) => f.transformId))];
    onLine(
      `  Scanned ${report.findings.length} pattern(s) in ${filesAnalyzed} file(s).`,
      theme.colors.success,
    );
    if (transformsHit.length > 0) {
      onLine(`  ${theme.symbols.bullet} ${transformsHit.join(', ')}`, theme.colors.textDim);
    }
    formatAnalysis(analysisResult, onLine);
    onLine('', undefined);
    onLine(`  Session ${session.id}  —  ${issues.length} pattern(s) found.`, theme.colors.textDim);
    onLine(
      '  Next: `run --dry-run` to preview changes · `run --apply` to verify + write.',
      theme.colors.textDim,
    );
    onLine('', undefined);
    return {};
  }

  // ── run — v2 refactor pipeline (analyze → plan → verify → write) ────────

  if (command === 'run') {
    const active = ctx.sessions.getActive();
    if (!active) {
      onLine('', undefined);
      onLine(
        `  ${theme.symbols.fail}  No active session. Run: analyze <target> first.`,
        theme.colors.error,
      );
      onLine('', undefined);
      return {};
    }

    const sessionTarget = active.analysis.target;
    const apply = flags['apply'] === true;
    const transformsFlag = flags['transforms'];
    const transforms: TransformId[] =
      typeof transformsFlag === 'string' && transformsFlag !== 'all'
        ? (transformsFlag
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean) as TransformId[])
        : [];

    onLine('', undefined);
    onLine(`  Planning refactor for ${sessionTarget} …`, theme.colors.textDim);
    const analyzer = new RefactronAnalyzer({ confidence: 'high' });
    const report = await analyzer.analyzeExtended(sessionTarget);
    if (signal.aborted) return {};

    const refactorer = new RefactronRefactorer({ projectRoot: sessionTarget });
    const plan = await refactorer.plan(report, transforms);
    if (signal.aborted) return {};

    if (plan.changes.length === 0) {
      onLine('  No changes to apply.', theme.colors.textDim);
      onLine('', undefined);
      return {};
    }

    if (!apply) {
      onLine(`  Dry-run: ${plan.changes.length} file(s) would change.`, theme.colors.accent);
      for (const c of plan.changes) {
        onLine(
          `  ${theme.symbols.bullet} ${path.relative(sessionTarget, c.path)}`,
          theme.colors.textDim,
        );
      }
      onLine('  Re-run with --apply to verify and write changes.', theme.colors.textDim);
      onLine('', undefined);
      return {};
    }

    // Capture pre-write content for each planned path so the documentation
    // engine (or any post-apply consumer) can reconstruct old → new diffs
    // after writeBatchAtomic has replaced the on-disk contents.
    const originalsBeforeWrite = new Map<string, string>();
    for (const change of plan.changes) {
      try {
        const buf = await fsp.readFile(change.path, 'utf8');
        originalsBeforeWrite.set(change.path, buf);
      } catch {
        // Missing/unreadable file — skip; documentation will simply not
        // generate for this path.
      }
    }

    onLine(`  Verifying ${plan.changes.length} change(s) …`, theme.colors.textDim);
    const verifier = new RefactronVerifier({ projectRoot: sessionTarget });
    const result = await verifier.verify(plan);
    if (signal.aborted) return {};

    if (!result.passed) {
      const failed = (
        Object.entries(result.gates) as Array<
          [string, { passed: boolean; blockingReason?: string }]
        >
      ).find(([, g]) => !g.passed);
      onLine(
        `  ${theme.symbols.fail}  Verification failed at gate '${failed?.[0] ?? 'unknown'}': ${
          failed?.[1].blockingReason ?? 'unknown'
        }`,
        theme.colors.error,
      );
      onLine('', undefined);
      return {};
    }

    await writeBatchAtomic(result.writableChanges);
    await persistLastApply({
      projectRoot: sessionTarget,
      verifiedAt: new Date().toISOString(),
      changes: result.writableChanges.map((c) => ({
        path: c.path,
        oldContent: originalsBeforeWrite.get(c.path) ?? '',
        newContent: c.newContent,
        transformId: c.transformId,
      })),
    });
    onLine(
      `  ${theme.symbols.pass}  ${result.writableChanges.length} file(s) refactored and verified.`,
      theme.colors.success,
    );
    onLine('', undefined);
    return {};
  }

  // ── status — active session details ──────────────────────────────────────

  if (command === 'status') {
    const active = ctx.sessions.getActive();
    if (active) {
      printSessionCard(active, ctx.projectRoot, onLine);
    } else {
      // Fall back to latest persisted session
      const latest = await ctx.sessions.latest();
      if (!latest) {
        onLine('  No session found. Run: analyze <target>', theme.colors.textDim);
      } else {
        onLine('  (No active session — showing latest saved)', theme.colors.textDim);
        printSessionCard(latest, ctx.projectRoot, onLine);
      }
    }
    return {};
  }

  // ── session list / session <id> ───────────────────────────────────────────

  if (command === 'session') {
    if (target === 'list' || target === '.') {
      const sessions = await ctx.sessions.list();
      if (sessions.length === 0) {
        onLine('  No saved sessions.', theme.colors.textDim);
        return {};
      }
      onLine('', undefined);
      onLine(`  ${sessions.length} saved session(s):`, theme.colors.accent);
      for (const s of sessions) {
        const rel = path.relative(ctx.projectRoot, s.analysis.target) || '.';
        const active = ctx.sessions.getActive()?.id === s.id ? ' ← active' : '';
        const age = new Date(s.createdAt).toLocaleString();
        onLine(
          `  ${theme.symbols.bullet}  ${s.id}  ${s.phase.padEnd(10)}  ${s.analysis.totalIssues} issues  ${rel}  ${age}${active}`,
          active ? theme.colors.brand : theme.colors.text,
        );
      }
      onLine('', undefined);
    } else {
      // session <id> — load and activate
      const loaded = await ctx.sessions.load(target);
      if (!loaded) {
        onLine(`  ${theme.symbols.fail}  Session not found: ${target}`, theme.colors.error);
        return {};
      }
      ctx.sessions.setActive(loaded);
      onLine('', undefined);
      onLine(`  ${theme.symbols.pass}  Loaded session ${loaded.id}`, theme.colors.success);
      printSessionCard(loaded, ctx.projectRoot, onLine);
    }
    return {};
  }

  // ── rollback ──────────────────────────────────────────────────────────────

  if (command === 'rollback') {
    onLine('  Rollback restores files from the last autofix backup.', theme.colors.textDim);
    onLine('  Run: autofix <target> to create a new session with backups.', theme.colors.textDim);
    return {};
  }

  if (command === 'clear') {
    onLine('\x1Bc', undefined);
    return {};
  }

  // ── init — scaffold .refactronrc.json in the project root ───────────────
  if (command === 'init') {
    const fs = await import('node:fs/promises');
    const target = parsed.target ?? ctx.projectRoot;
    const cfgPath = path.resolve(target, '.refactronrc.json');
    try {
      await fs.access(cfgPath);
      onLine(
        `  ${theme.symbols.fail}  .refactronrc.json already exists at ${cfgPath}`,
        theme.colors.error,
      );
      return {};
    } catch {
      // doesn't exist — proceed
    }
    const TEMPLATE = {
      $schema: 'https://refactron.dev/schema/refactronrc.json',
      transforms: ['all'],
      exclude: ['node_modules', 'dist', '.venv', '__pycache__'],
      testCmd: null,
      confidence: 'high',
      dryRun: true,
    };
    await fs.writeFile(cfgPath, JSON.stringify(TEMPLATE, null, 2) + '\n');
    onLine(`  ${theme.symbols.pass}  created ${cfgPath}`, theme.colors.success);
    return {};
  }

  if (command === '') return {};

  onLine(`  Unknown command: ${command}. Type help for usage.`, theme.colors.error);
  return {};
}
