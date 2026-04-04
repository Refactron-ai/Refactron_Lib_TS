// src/cli/runner.ts
// Command execution engine — runs a parsed command, streams output lines via onLine()
import path from 'path';
import fs from 'fs/promises';
import type { ILanguageAdapter } from '../adapters/interface.js';
import type { RefactronConfig } from '../core/config.js';
import type { AnalysisResult, PipelineSession, Severity } from '../core/models.js';
import { VerificationEngine } from '../verification/engine.js';
import { Orchestrator } from '../core/orchestrator.js';
import { SessionStore } from '../pipeline/store.js';
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
  '',
]);

export interface CommandContext {
  adapter: ILanguageAdapter;
  config: RefactronConfig;
  projectRoot: string;
  // Persists across REPL commands — set by analyze, reused by autofix/verify
  lastAnalysis?: AnalysisResult;
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
  for (const issue of result.issues) {
    bySeverity[issue.severity].push(issue);
  }

  // Group by severity, show up to 20 per group
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
    if (group.length > 20) {
      onLine(`    ... and ${group.length - 20} more`, theme.colors.textDim);
    }
  }

  onLine('', undefined);
  const fixable = result.issues.filter((i) => i.fixable).length;
  const crit = bySeverity.critical.length;
  const high = bySeverity.high.length;
  const med = bySeverity.medium.length;
  const low = bySeverity.low.length;
  onLine(
    `  ${crit} critical  ${high} high  ${med} medium  ${low} low  —  ${fixable} autofixable  |  ${result.filesAnalyzed} files  ${result.durationMs}ms`,
    crit > 0 ? theme.colors.critical : high > 0 ? theme.colors.high : theme.colors.textDim,
  );
}

function formatSession(
  session: PipelineSession,
  onLine: (line: string, color?: string) => void,
): void {
  onLine('', undefined);
  onLine(`  Applied:  ${session.appliedFixes.length}`, theme.colors.success);
  onLine(
    `  Blocked:  ${session.blockedFixes.length}`,
    session.blockedFixes.length > 0 ? theme.colors.error : theme.colors.textDim,
  );
  if (session.blockedFixes.length > 0) {
    for (const fix of session.blockedFixes) {
      onLine(
        `    ${theme.symbols.fail} ${fix.filePath}:${fix.lineNumber} — ${fix.message}`,
        theme.colors.textDim,
      );
    }
  }
  onLine(`  State:    ${session.state}`, theme.colors.textDim);
}

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

  // ── Auth commands (exempt from auth check) ──────────────────────────────

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
    // auth status
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

  // ── Auth gate — all other commands require a valid token ─────────────────

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
    onLine('  analyze  [target]              scan files for issues', theme.colors.text);
    onLine('  autofix  [target] [--dry-run] [--verify]  fix with verification', theme.colors.text);
    onLine('  verify   [file]                verify a file is safe', theme.colors.text);
    onLine('  status                         show last session', theme.colors.text);
    onLine('  rollback                       restore from last backup', theme.colors.text);
    onLine('  diff     [target]              show fix diff', theme.colors.text);
    onLine('  login                          authenticate with Refactron', theme.colors.text);
    onLine('  logout                         remove stored credentials', theme.colors.text);
    onLine('  auth                           show auth status', theme.colors.text);
    onLine('  clear                          clear the screen', theme.colors.text);
    onLine('  exit                           quit refactron', theme.colors.text);
    onLine('', undefined);
    return {};
  }

  if (command === 'analyze') {
    onLine(`  Scanning ${absTarget} …`, theme.colors.textDim);
    const orchestrator = new Orchestrator(ctx.adapter, ctx.config, ctx.projectRoot);
    const { analysis } = await orchestrator.analyze(absTarget);
    if (signal.aborted) return {};
    ctx.lastAnalysis = analysis; // persist for autofix / verify
    formatAnalysis(analysis, onLine);
    onLine(`  ${theme.symbols.pass}  Analysis saved — run autofix or verify to continue.`, theme.colors.textDim);
    return {};
  }

  if (command === 'autofix') {
    const dryRun = flags['dry-run'] === true;
    const verify = flags['verify'] === true;
    const orchestrator = new Orchestrator(ctx.adapter, ctx.config, ctx.projectRoot);

    let session: PipelineSession;
    if (ctx.lastAnalysis && ctx.lastAnalysis.target === absTarget) {
      // Reuse prior analysis — skip re-scan
      const fixable = ctx.lastAnalysis.issues.filter((i) => i.fixable).length;
      onLine(`  ${dryRun ? 'Previewing' : 'Fixing'} ${fixable} fixable issue(s) from last analysis …`, theme.colors.textDim);
      session = await orchestrator.autofixFromAnalysis(ctx.lastAnalysis, { dryRun, verify });
    } else {
      // Fresh analysis + fix
      onLine(`  Analyzing ${absTarget} …`, theme.colors.textDim);
      const result = await orchestrator.autofix(absTarget, { dryRun, verify });
      ctx.lastAnalysis = result.analysis; // update cache
      session = result.session;
    }

    if (signal.aborted) return {};
    formatSession(session, onLine);
    return {};
  }

  if (command === 'status') {
    const store = new SessionStore(ctx.projectRoot);
    const session = await store.latest();
    if (!session) {
      onLine('  No session found. Run: analyze <target>', theme.colors.textDim);
      return {};
    }
    onLine(`  Session  ${session.sessionId}`, theme.colors.accent);
    onLine(`  Target   ${session.target}`, theme.colors.textDim);
    onLine(`  Issues   ${session.totalIssues}  |  Files ${session.totalFiles}`, theme.colors.text);
    formatSession(session, onLine);
    return {};
  }

  if (command === 'verify') {
    if (!ctx.lastAnalysis) {
      onLine('', undefined);
      onLine(`  ${theme.symbols.fail}  No analysis in session. Run: analyze <target> first.`, theme.colors.error);
      onLine('', undefined);
      return {};
    }

    // Filter to specific file if provided, else all analyzed files
    const specificFile = target !== '.' ? absTarget : null;
    const issues = specificFile
      ? ctx.lastAnalysis.issues.filter((i) => i.file === specificFile)
      : ctx.lastAnalysis.issues;

    const fixableFiles = [...new Set(issues.filter((i) => i.fixable).map((i) => i.file))];

    if (fixableFiles.length === 0) {
      onLine('  No fixable issues to verify in last analysis.', theme.colors.textDim);
      return {};
    }

    const verEngine = new VerificationEngine(ctx.adapter);
    onLine('', undefined);
    onLine(`  Verifying ${fixableFiles.length} file(s) from last analysis …`, theme.colors.textDim);
    onLine('', undefined);

    let passed = 0;
    let blocked = 0;
    for (const file of fixableFiles) {
      if (signal.aborted) return {};
      const fileIssues = issues.filter((i) => i.file === file && i.fixable);
      // Use highest blast radius among the file's issues
      const maxBlast = fileIssues.reduce(
        (max, i) => (i.blastRadius.score > max.score ? i.blastRadius : max),
        fileIssues[0]!.blastRadius,
      );
      const currentCode = await fs.readFile(file, 'utf-8');
      const result = await verEngine.verify(file, currentCode, maxBlast);
      const rel = path.relative(ctx.projectRoot, file);
      const confidence = `${Math.round(result.confidenceScore * 100)}%`;
      if (result.safeToApply) {
        onLine(`  ${theme.symbols.pass}  ${rel}  (confidence: ${confidence})`, theme.colors.success);
        passed++;
      } else {
        onLine(`  ${theme.symbols.fail}  ${rel}  — ${result.blockingReason ?? 'blocked'}  (confidence: ${confidence})`, theme.colors.error);
        blocked++;
      }
    }

    onLine('', undefined);
    onLine(
      `  ${passed} passed  ${blocked} blocked  —  ${fixableFiles.length} file(s) checked`,
      blocked > 0 ? theme.colors.error : theme.colors.success,
    );
    onLine('', undefined);
    return {};
  }

  if (command === 'rollback') {
    onLine('  Rollback is applied per-session via BackupManager.', theme.colors.textDim);
    onLine('  Run: autofix <target> to start a new session with backups.', theme.colors.textDim);
    return {};
  }

  if (command === 'diff') {
    onLine('  No pending diff. Run: autofix <target> --dry-run', theme.colors.textDim);
    return {};
  }

  if (command === 'clear') {
    // Signal handled in REPL
    onLine('\x1Bc', undefined);
    return {};
  }

  if (command === '') return {};

  onLine(`  Unknown command: ${command}. Type help for usage.`, theme.colors.error);
  return {};
}
