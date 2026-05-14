// src/cli/document-command.ts
// One-shot CLI entry point for `refactron document`. Loads the last verified
// apply snapshot, hands it to the documentation engine, and either prints the
// resulting DocPatch (dry-run / --json) or applies it to disk (--apply).
//
// Provider selection priority:
//   1. deps.providerOverride (test seam)
//   2. REFACTRON_DOCUMENT_MOCK=1 → deterministic MockLLMProvider
//   3. .refactronrc documentation block via pickProvider()
//
// Exit codes:
//   0  success (dry-run or apply)
//   7  missing auth
//   8  no .refactron/last-apply.json snapshot
//   9  provider configuration error (missing API key, factory throw)
//  10  parse / internal error
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import writeAtomic from 'write-file-atomic';
import type { LLMProvider, DocumenterOptions } from '../document/types.js';
import { MockLLMProvider } from '../document/provider/mock.js';
import { pickProvider, type ProviderConfig } from '../document/provider/factory.js';
import { loadCredentials } from '../auth/credentials.js';
import { RefactronDocumenter } from '../document/engine.js';
import { insertDocstring, appendChangelog } from '../document/apply.js';
import type { VerificationResult } from '../contracts.js';
import { requireAuth } from './auth-gate.js';
import { loadRefactronConfig } from './config-loader.js';
import { loadLastApply } from './last-apply.js';

/** Sink for runDocumentCommand's human-readable output.
 *  Each call corresponds to one chunk of text already terminated with '\n'
 *  (matching the existing `process.stdout.write(s + '\n')` shape). The REPL
 *  passes a sink that splits chunks on newlines and re-emits via onLine; the
 *  one-shot CLI uses the default which forwards directly to process.stdout /
 *  process.stderr.
 *
 *  Without this seam, the REPL invoked runDocumentCommand and the raw stdout
 *  writes vanished into Ink's render buffer — `document` looked like it did
 *  nothing even though CHANGELOG.md was being updated under the hood.
 */
export type DocumentOutputSink = (text: string, stream: 'stdout' | 'stderr') => void;

const defaultOutputSink: DocumentOutputSink = (text, stream) => {
  if (stream === 'stderr') process.stderr.write(text);
  else process.stdout.write(text);
};

export interface RunDocumentCommandDeps {
  providerOverride?: LLMProvider;
  out?: DocumentOutputSink;
}

interface ParsedFlags {
  target: string;
  apply: boolean;
  noCache: boolean;
  json: boolean;
  provider: string | null;
  model: string | null;
}

class DocumentFlagError extends Error {}

function parseFlags(argv: string[]): ParsedFlags {
  let target: string | null = null;
  let apply = false;
  let noCache = false;
  let json = false;
  let provider: string | null = null;
  let model: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--apply') {
      apply = true;
      continue;
    }
    if (a === '--no-cache') {
      noCache = true;
      continue;
    }
    if (a === '--json') {
      json = true;
      continue;
    }
    if (a === '--provider' || a.startsWith('--provider=')) {
      const v = a.includes('=') ? a.slice('--provider='.length) : argv[++i];
      if (!v) throw new DocumentFlagError('--provider requires a value');
      provider = v;
      continue;
    }
    if (a === '--model' || a.startsWith('--model=')) {
      const v = a.includes('=') ? a.slice('--model='.length) : argv[++i];
      if (!v) throw new DocumentFlagError('--model requires a value');
      model = v;
      continue;
    }
    if (a.startsWith('-')) throw new DocumentFlagError(`unknown flag: ${a}`);
    if (target !== null) {
      throw new DocumentFlagError(`unexpected extra argument: ${a}`);
    }
    target = a;
  }
  return { target: target ?? '.', apply, noCache, json, provider, model };
}

function buildMockProvider(): LLMProvider {
  return new MockLLMProvider((prompt: string): string => {
    if (prompt.includes('CHANGELOG')) return '- refactor applied across project';
    const m = prompt.match(/Function name:\s*(\w+)/);
    const name = m?.[1] ?? 'symbol';
    return `Documents the ${name} function.`;
  });
}

function detectLanguage(filePath: string): 'python' | 'typescript' | null {
  if (filePath.endsWith('.py')) return 'python';
  if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) return 'typescript';
  return null;
}

// The engine sets changelogEntry to "Documentation skipped: <reason>." when
// the LLM provider is unreachable / rate-limited / returns garbage. We use
// this prefix as a sentinel to distinguish a real LLM failure from a
// zero-symbols-to-document outcome (engine ran fine, chunker just had no
// functions or classes to operate on — common after commonjs_to_esm,
// var_to_const_let, or any module-level transform).
const SKIPPED_MARKER = 'Documentation skipped:';

function isProviderSkip(changelogEntry: string): boolean {
  return changelogEntry.startsWith(SKIPPED_MARKER);
}

const PROJECT_ROOT_MARKERS = [
  'package.json',
  'pyproject.toml',
  '.git',
  '.refactronrc.json',
  '.refactronrc',
];

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Walk up from `start` looking for a project marker (package.json,
 *  pyproject.toml, .git, .refactronrc.json). Capped at `boundary` so we
 *  never escape the snapshot's projectRoot. Returns `start` if no marker
 *  is found within bounds.
 */
async function walkUpForProjectMarker(start: string, boundary: string): Promise<string> {
  const absStart = path.resolve(start);
  const absBoundary = path.resolve(boundary);
  let dir = absStart;
  for (;;) {
    for (const marker of PROJECT_ROOT_MARKERS) {
      if (await pathExists(path.join(dir, marker))) return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return absStart;
    if (path.relative(absBoundary, parent).startsWith('..')) return absStart;
    dir = parent;
  }
}

/** Common-ancestor directory of all paths. POSIX semantics on the
 *  resolved absolute paths; on Windows path.relative + path.dirname
 *  Just Work because we only use them, not the separator directly.
 */
function commonAncestor(paths: string[]): string {
  if (paths.length === 0) return process.cwd();
  const dirs = paths.map((p) => path.dirname(path.resolve(p)).split(path.sep));
  const head = dirs[0]!;
  let i = 0;
  while (i < head.length) {
    const seg = head[i];
    if (!dirs.every((d) => d[i] === seg)) break;
    i++;
  }
  return dirs[0]!.slice(0, i).join(path.sep) || path.sep;
}

/** Where to write CHANGELOG.md. Computed as the common ancestor of all
 *  changed files, then walked up to the nearest project marker (capped
 *  at the snapshot's projectRoot). Avoids the bug where document was
 *  writing CHANGELOG.md to the user's *cwd* — which on a Refactron-self
 *  test was Refactron's own repo root, polluting it with fixture entries.
 */
async function pickChangelogDir(
  changes: ReadonlyArray<{ path: string }>,
  snapshotProjectRoot: string,
): Promise<string> {
  if (changes.length === 0) return path.resolve(snapshotProjectRoot);
  const ancestor = commonAncestor(changes.map((c) => c.path));
  return walkUpForProjectMarker(ancestor, snapshotProjectRoot);
}

export async function runDocumentCommand(
  argv: string[],
  deps: RunDocumentCommandDeps = {},
): Promise<number> {
  const out = deps.out ?? defaultOutputSink;
  let flags: ParsedFlags;
  try {
    flags = parseFlags(argv);
  } catch (err) {
    if (err instanceof DocumentFlagError) {
      out(`refactron document: ${err.message}\n`, 'stderr');
      return 10;
    }
    throw err;
  }

  const authResult = await requireAuth('document');
  if (authResult !== true) return authResult;

  const target = path.resolve(flags.target);

  const snapshot = await loadLastApply(target);
  if (snapshot === null) {
    out(
      "refactron document: No verified refactor in this project — run 'run --apply' first.\n",
      'stderr',
    );
    return 8;
  }

  let config: Awaited<ReturnType<typeof loadRefactronConfig>>;
  try {
    config = await loadRefactronConfig(target);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    out(`refactron document: ${msg}\n`, 'stderr');
    return 10;
  }

  // ── Provider selection ────────────────────────────────────────────────────
  let provider: LLMProvider;
  const effectiveProvider = flags.provider ?? config.documentation.provider;
  const effectiveModel = flags.model ?? config.documentation.model;
  if (deps.providerOverride !== undefined) {
    provider = deps.providerOverride;
  } else if (process.env.REFACTRON_DOCUMENT_MOCK === '1') {
    provider = buildMockProvider();
  } else {
    try {
      const providerConfig: ProviderConfig = {
        provider: effectiveProvider as ProviderConfig['provider'],
        model: effectiveModel,
        endpoint: config.documentation.endpoint,
      };
      // The 'backend' provider needs Refactron credentials (api_key OR
      // access_token) — we already loaded them via requireAuth above, but
      // the factory takes the raw object so pass it through here. Safe to
      // call again; loadCredentials reads a small JSON file or an env var.
      const creds = await loadCredentials();
      provider = pickProvider(providerConfig, process.env, creds);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      out(`refactron document: ${msg}\n`, 'stderr');
      return 9;
    }
  }

  // ── Build DocumenterOptions ───────────────────────────────────────────────
  const originals = new Map<string, string>(snapshot.changes.map((c) => [c.path, c.oldContent]));
  const useCache = !flags.noCache && config.documentation.cache;
  const cacheDir = useCache ? path.join(target, '.refactron', 'cache', 'llm') : null;
  const opts: DocumenterOptions = {
    provider,
    model: effectiveModel,
    tokenBudget: config.documentation.tokenBudget,
    cacheDir,
    redactPatterns: config.documentation.redactPatterns,
    originals,
  };

  const verified: VerificationResult = {
    passed: true,
    gates: {
      syntax: { passed: true, durationMs: 0 },
      imports: { passed: true, durationMs: 0 },
      tests: { passed: true, durationMs: 0 },
    },
    writableChanges: snapshot.changes.map((c) => ({
      path: c.path,
      oldHash: '',
      newContent: c.newContent,
      transformId: c.transformId,
    })),
  };

  const documenter = new RefactronDocumenter(opts);
  const patch = await documenter.document(verified);

  // ── Output / apply ────────────────────────────────────────────────────────
  if (flags.json) {
    out(JSON.stringify(patch, null, 2) + '\n', 'stdout');
    return 0;
  }

  // Distinguish three outcomes the user needs to act on differently:
  //   (a) provider unreachable / errored — engine fell back to canned
  //       changelog. Don't pretend there's anything to apply.
  //   (b) provider OK but the chunker found no documentable symbols
  //       (module-level transform, no functions / classes touched).
  //   (c) real success — at least one docstring ready.
  const providerSkipped = isProviderSkip(patch.changelogEntry);
  const noSymbols = !providerSkipped && patch.docstrings.length === 0;

  if (!flags.apply) {
    if (providerSkipped) {
      const reason = patch.changelogEntry.replace(SKIPPED_MARKER, '').trim();
      out(
        `refactron document: skipped — could not reach the LLM provider\n` +
          `  Reason: ${reason}\n` +
          `  Your refactor remains applied and verified. Nothing was written.\n` +
          `\n` +
          `  To enable doc generation, set one in .refactronrc.json:\n` +
          `    • provider: 'backend'  (Pro plan, recommended; uses your refactron.dev account)\n` +
          `    • provider: 'groq'     (free tier, BYOK via GROQ_API_KEY)\n` +
          `    • provider: 'ollama'   (local, free; install with \`brew install ollama && ollama serve\`)\n`,
        'stderr',
      );
      return 0;
    }
    if (noSymbols) {
      const transformsApplied = [...new Set(snapshot.changes.map((c) => c.transformId))].sort();
      out(
        `refactron document: no documentable symbols in the last refactor\n` +
          `  Transforms applied: ${transformsApplied.join(', ')}\n` +
          `  These changes don't touch a function or class signature, so the\n` +
          `  LLM has nothing to describe — there are no docstrings to insert.\n` +
          `  Try a refactor that affects callable units (e.g. callback_to_async_await,\n` +
          `  class_to_dataclass, format_to_fstring). Nothing was written.\n`,
        'stdout',
      );
      return 0;
    }
    out(`refactron document: ${patch.docstrings.length} docstring(s) ready\n`, 'stdout');
    for (const d of patch.docstrings) {
      out(`  - ${path.relative(target, d.file)} :: ${d.symbol}\n`, 'stdout');
    }
    out('\nCHANGELOG entry:\n', 'stdout');
    out(`${patch.changelogEntry}\n`, 'stdout');
    out('\nRe-run with --apply to write docstrings and CHANGELOG.md.\n', 'stdout');
    return 0;
  }

  // --apply path
  if (providerSkipped) {
    const reason = patch.changelogEntry.replace(SKIPPED_MARKER, '').trim();
    out(
      `refactron document: skipped — could not reach the LLM provider\n` +
        `  Reason: ${reason}\n` +
        `  Nothing was written. Configure a provider in .refactronrc.json (see` +
        ` 'document --dry-run' for options) and re-run.\n`,
      'stderr',
    );
    return 0;
  }
  if (noSymbols) {
    const transformsApplied = [...new Set(snapshot.changes.map((c) => c.transformId))].sort();
    out(
      `refactron document: no documentable symbols in the last refactor\n` +
        `  Transforms applied: ${transformsApplied.join(', ')}\n` +
        `  Nothing to write — these transforms don't touch function/class signatures.\n`,
      'stdout',
    );
    return 0;
  }

  // --apply: write each docstring back to its file, then append changelog.
  // Group by file so multiple symbols in one file are inserted into the same
  // (latest) source view.
  const byFile = new Map<string, Array<{ symbol: string; content: string }>>();
  for (const d of patch.docstrings) {
    const list = byFile.get(d.file) ?? [];
    list.push({ symbol: d.symbol, content: d.content });
    byFile.set(d.file, list);
  }
  for (const [file, entries] of byFile) {
    const language = detectLanguage(file);
    if (language === null) continue;
    let source: string;
    try {
      source = await fs.readFile(file, 'utf8');
    } catch {
      continue;
    }
    for (const e of entries) {
      source = insertDocstring(language, source, e.symbol, e.content);
    }
    await writeAtomic(file, source);
  }

  // Write CHANGELOG next to the actually-changed files, NOT next to the
  // user's cwd. Previously this defaulted to `path.join(target, ...)` which
  // on a Refactron-self test put fixture-CHANGELOG entries into Refactron's
  // own repo CHANGELOG.md.
  const changelogDir = await pickChangelogDir(snapshot.changes, snapshot.projectRoot);
  const changelogPath = path.join(changelogDir, 'CHANGELOG.md');
  let existingChangelog = '';
  try {
    existingChangelog = await fs.readFile(changelogPath, 'utf8');
  } catch {
    existingChangelog = '';
  }
  const today = new Date().toISOString().slice(0, 10);
  const newChangelog = appendChangelog(existingChangelog, [patch.changelogEntry], today);
  await writeAtomic(changelogPath, newChangelog);

  out(
    `refactron document: wrote ${patch.docstrings.length} docstring(s) and updated ${path.relative(target, changelogPath) || changelogPath}\n`,
    'stdout',
  );
  return 0;
}
