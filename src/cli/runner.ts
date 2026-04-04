// src/cli/runner.ts
// Command execution engine — runs a parsed command, streams output lines via onLine()
import path from 'path';
import fs from 'fs/promises';
import type { ILanguageAdapter } from '../adapters/interface.js';
import type { RefactronConfig } from '../core/config.js';
import type { AnalysisResult, Severity } from '../core/models.js';
import { VerificationEngine } from '../verification/engine.js';
import { Orchestrator } from '../core/orchestrator.js';
import { WorkSessionManager } from '../session/manager.js';
import type { WorkSession, WorkSessionVerifyEntry } from '../session/types.js';
import { theme } from '../ui/theme.js';
import {
  loadCredentials,
  deleteCredentials,
  isAuthenticated,
  runLoginFlow,
} from '../auth/index.js';

// Commands that never require auth
const AUTH_EXEMPT = new Set([
  'login', 'logout', 'auth', 'help', '?',
  'clear', 'exit', 'quit', 'q', 'session', 'issues', '',
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
    trivial: 'trivial', low: 'low', medium: 'med', high: 'HIGH', critical: 'CRIT',
  };
  return map[level] ?? level;
}

function formatAnalysis(
  result: AnalysisResult,
  onLine: (line: string, color?: string) => void,
): void {
  const bySeverity: Record<Severity, typeof result.issues> = {
    critical: [], high: [], medium: [], low: [],
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
  const { critical: c, high: h, medium: m, low: l } = {
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
  onLine(`  Issues   ${session.analysis.totalIssues}  (${session.analysis.fixableCount} fixable)`, theme.colors.text);
  onLine(`  Files    ${session.analysis.filesAnalyzed}  scanned`, theme.colors.textDim);
  onLine(`  Created  ${age}`, theme.colors.textDim);
  if (session.fix) {
    onLine(`  Fix      ${session.fix.appliedCount} applied  ${session.fix.blockedCount} blocked${session.fix.dryRun ? '  [dry-run]' : ''}`, theme.colors.text);
  }
  if (session.verify) {
    onLine(`  Verify   ${session.verify.passed} passed  ${session.verify.blocked} blocked`, theme.colors.text);
  }
  onLine('', undefined);
}

// ── Main executor ────────────────────────────────────────────────────────────

export interface CommandResult {
  shouldExit?: boolean;
  openBrowser?: boolean; // trigger interactive issue browser in REPL
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
      const { creds, requiresApiKey } = await runLoginFlow(
        noBrowser,
        (msg) => onLine(`  ${msg}`, theme.colors.textDim),
      );
      onLine('', undefined);
      if (requiresApiKey) {
        onLine(`  ${theme.symbols.pass}  OAuth complete. Run  refactron  to set your API key.`, theme.colors.warning);
      } else {
        onLine(`  ${theme.symbols.pass}  Logged in as ${creds.email ?? 'unknown'} (${creds.plan ?? 'free'} plan)`, theme.colors.success);
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
      onLine(`  │  Plan      ${(creds.plan?.toUpperCase() ?? 'FREE').padEnd(21)}│`, theme.colors.text);
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
    onLine('  Commands:', theme.colors.accent);
    onLine('  analyze  [target]              scan files, create a session', theme.colors.text);
    onLine('  issues                         open interactive issue browser', theme.colors.text);
    onLine('  autofix  [--dry-run] [--verify] fix all fixable issues in session', theme.colors.text);
    onLine('  verify   [file]                verify files in active session', theme.colors.text);
    onLine('  status                         show active session details', theme.colors.text);
    onLine('  session list                   list all saved sessions', theme.colors.text);
    onLine('  session <id>                   load a previous session', theme.colors.text);
    onLine('  rollback                       restore from last backup', theme.colors.text);
    onLine('  diff                           show fix diff', theme.colors.text);
    onLine('  login                          authenticate with Refactron', theme.colors.text);
    onLine('  logout                         remove stored credentials', theme.colors.text);
    onLine('  auth                           show auth status', theme.colors.text);
    onLine('  clear                          clear the screen', theme.colors.text);
    onLine('  exit                           quit refactron', theme.colors.text);
    onLine('', undefined);
    return {};
  }

  // ── issues — open interactive browser ───────────────────────────────────

  if (command === 'issues') {
    const active = ctx.sessions.getActive();
    if (!active) {
      onLine('', undefined);
      onLine(`  ${theme.symbols.fail}  No active session. Run: analyze <target> first.`, theme.colors.error);
      onLine('', undefined);
      return {};
    }
    return { openBrowser: true };
  }

  // ── analyze — creates a new session ─────────────────────────────────────

  if (command === 'analyze') {
    onLine(`  Scanning ${absTarget} …`, theme.colors.textDim);
    const orchestrator = new Orchestrator(ctx.adapter, ctx.config, ctx.projectRoot);
    const { analysis } = await orchestrator.analyze(absTarget);
    if (signal.aborted) return {};

    // Build session context from analysis result
    const bySeverity: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const issue of analysis.issues) bySeverity[issue.severity]++;
    const fixableCount = analysis.issues.filter((i) => i.fixable).length;

    const session = ctx.sessions.createSession({
      target: analysis.target,
      filesAnalyzed: analysis.filesAnalyzed,
      filesSkipped: analysis.filesSkipped,
      totalIssues: analysis.issues.length,
      fixableCount,
      issuesBySeverity: bySeverity,
      issues: analysis.issues,
      durationMs: analysis.durationMs,
      timestamp: analysis.timestamp.toISOString(),
    });
    ctx.sessions.setActive(session);
    await ctx.sessions.save(session);

    formatAnalysis(analysis, onLine);
    onLine('', undefined);
    onLine(`  ${theme.symbols.pass}  Session ${session.id}  —  ${analysis.issues.length} issues found. Opening browser…`, theme.colors.textDim);
    onLine('', undefined);
    return { openBrowser: true };
  }

  // ── autofix — operates on active session ─────────────────────────────────

  if (command === 'autofix') {
    const active = ctx.sessions.getActive();
    if (!active) {
      onLine('', undefined);
      onLine(`  ${theme.symbols.fail}  No active session. Run: analyze <target> first.`, theme.colors.error);
      onLine('', undefined);
      return {};
    }

    const dryRun = flags['dry-run'] === true;
    const verify = flags['verify'] === true;
    const fixable = active.analysis.issues.filter((i) => i.fixable).length;

    onLine('', undefined);
    onLine(`  ${dryRun ? 'Previewing' : 'Fixing'} ${fixable} fixable issue(s) from session ${active.id} …`, theme.colors.textDim);

    // Reconstruct AnalysisResult from session
    const analysisResult: AnalysisResult = {
      target: active.analysis.target,
      filesAnalyzed: active.analysis.filesAnalyzed,
      filesSkipped: active.analysis.filesSkipped,
      issues: active.analysis.issues,
      languageBreakdown: {},
      durationMs: active.analysis.durationMs,
      timestamp: new Date(active.analysis.timestamp),
    };

    const orchestrator = new Orchestrator(ctx.adapter, ctx.config, ctx.projectRoot);
    const session = await orchestrator.autofixFromAnalysis(analysisResult, { dryRun, verify });
    if (signal.aborted) return {};

    // Save fix results back into the work session
    const updated = ctx.sessions.updateActive({
      phase: 'fixed',
      fix: {
        dryRun,
        appliedCount: session.appliedFixes.length,
        blockedCount: session.blockedFixes.length,
        appliedFixes: session.appliedFixes,
        blockedFixes: session.blockedFixes,
        timestamp: new Date().toISOString(),
      },
    });
    if (updated) await ctx.sessions.save(updated);

    onLine('', undefined);
    onLine(`  Applied:  ${session.appliedFixes.length}`, theme.colors.success);
    onLine(
      `  Blocked:  ${session.blockedFixes.length}`,
      session.blockedFixes.length > 0 ? theme.colors.error : theme.colors.textDim,
    );
    for (const fix of session.blockedFixes) {
      onLine(`    ${theme.symbols.fail} ${fix.filePath}:${fix.lineNumber} — ${fix.message}`, theme.colors.textDim);
    }
    onLine(`  State:    ${session.state}`, theme.colors.textDim);
    onLine('', undefined);
    return {};
  }

  // ── verify — operates on active session ──────────────────────────────────

  if (command === 'verify') {
    const active = ctx.sessions.getActive();
    if (!active) {
      onLine('', undefined);
      onLine(`  ${theme.symbols.fail}  No active session. Run: analyze <target> first.`, theme.colors.error);
      onLine('', undefined);
      return {};
    }

    const specificFile = target !== '.' ? absTarget : null;
    const issues = specificFile
      ? active.analysis.issues.filter((i) => i.file === specificFile)
      : active.analysis.issues;

    const fixableFiles = [...new Set(issues.filter((i) => i.fixable).map((i) => i.file))];
    if (fixableFiles.length === 0) {
      onLine('  No fixable issues to verify in active session.', theme.colors.textDim);
      return {};
    }

    const verEngine = new VerificationEngine(ctx.adapter);
    onLine('', undefined);
    onLine(`  Verifying ${fixableFiles.length} file(s) from session ${active.id} …`, theme.colors.textDim);
    onLine('', undefined);

    let passed = 0;
    let blocked = 0;
    const entries: WorkSessionVerifyEntry[] = [];

    for (const file of fixableFiles) {
      if (signal.aborted) return {};
      const fileIssues = issues.filter((i) => i.file === file && i.fixable);
      const maxBlast = fileIssues.reduce(
        (max, i) => (i.blastRadius.score > max.score ? i.blastRadius : max),
        fileIssues[0]!.blastRadius,
      );
      const currentCode = await fs.readFile(file, 'utf-8');
      const result = await verEngine.verify(file, currentCode, maxBlast);
      const rel = path.relative(ctx.projectRoot, file);
      const confidence = `${Math.round(result.confidenceScore * 100)}%`;

      entries.push({
        file,
        safe: result.safeToApply,
        confidence: result.confidenceScore,
        reason: result.blockingReason,
        checksRun: result.checksRun,
      });

      if (result.safeToApply) {
        onLine(`  ${theme.symbols.pass}  ${rel}  (confidence: ${confidence})`, theme.colors.success);
        passed++;
      } else {
        onLine(`  ${theme.symbols.fail}  ${rel}  — ${result.blockingReason ?? 'blocked'}  (confidence: ${confidence})`, theme.colors.error);
        blocked++;
      }
    }

    const updated = ctx.sessions.updateActive({
      phase: 'verified',
      verify: { filesChecked: fixableFiles.length, passed, blocked, entries, timestamp: new Date().toISOString() },
    });
    if (updated) await ctx.sessions.save(updated);

    onLine('', undefined);
    onLine(
      `  ${passed} passed  ${blocked} blocked  —  ${fixableFiles.length} file(s) checked`,
      blocked > 0 ? theme.colors.error : theme.colors.success,
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

  if (command === 'diff') {
    const active = ctx.sessions.getActive();
    if (!active?.fix) {
      onLine('  No fix results in active session. Run: autofix first.', theme.colors.textDim);
      return {};
    }
    for (const fix of active.fix.appliedFixes) {
      if (fix.diff) {
        onLine(`  ${path.relative(ctx.projectRoot, fix.filePath)}:${fix.lineNumber}`, theme.colors.accent);
        onLine(fix.diff, undefined);
      }
    }
    return {};
  }

  if (command === 'clear') {
    onLine('\x1Bc', undefined);
    return {};
  }

  if (command === '') return {};

  onLine(`  Unknown command: ${command}. Type help for usage.`, theme.colors.error);
  return {};
}
