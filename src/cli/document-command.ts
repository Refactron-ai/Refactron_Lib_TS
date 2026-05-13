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
import { RefactronDocumenter } from '../document/engine.js';
import { insertDocstring, appendChangelog } from '../document/apply.js';
import type { VerificationResult } from '../contracts.js';
import { requireAuth } from './auth-gate.js';
import { loadRefactronConfig } from './config-loader.js';
import { loadLastApply } from './last-apply.js';

export interface RunDocumentCommandDeps {
  providerOverride?: LLMProvider;
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

export async function runDocumentCommand(
  argv: string[],
  deps: RunDocumentCommandDeps = {},
): Promise<number> {
  let flags: ParsedFlags;
  try {
    flags = parseFlags(argv);
  } catch (err) {
    if (err instanceof DocumentFlagError) {
      process.stderr.write(`refactron document: ${err.message}\n`);
      return 10;
    }
    throw err;
  }

  const authResult = await requireAuth('document');
  if (authResult !== true) return authResult;

  const target = path.resolve(flags.target);

  const snapshot = await loadLastApply(target);
  if (snapshot === null) {
    process.stderr.write(
      "refactron document: No verified refactor in this project — run 'run --apply' first.\n",
    );
    return 8;
  }

  let config: Awaited<ReturnType<typeof loadRefactronConfig>>;
  try {
    config = await loadRefactronConfig(target);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`refactron document: ${msg}\n`);
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
      provider = pickProvider(providerConfig, process.env);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`refactron document: ${msg}\n`);
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
    process.stdout.write(JSON.stringify(patch, null, 2) + '\n');
    return 0;
  }

  if (!flags.apply) {
    process.stdout.write(`refactron document: ${patch.docstrings.length} docstring(s) ready\n`);
    for (const d of patch.docstrings) {
      process.stdout.write(`  - ${path.relative(target, d.file)} :: ${d.symbol}\n`);
    }
    process.stdout.write('\nCHANGELOG entry:\n');
    process.stdout.write(`${patch.changelogEntry}\n`);
    process.stdout.write('\nRe-run with --apply to write docstrings and CHANGELOG.md.\n');
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

  const changelogPath = path.join(target, 'CHANGELOG.md');
  let existingChangelog = '';
  try {
    existingChangelog = await fs.readFile(changelogPath, 'utf8');
  } catch {
    existingChangelog = '';
  }
  const today = new Date().toISOString().slice(0, 10);
  const newChangelog = appendChangelog(existingChangelog, [patch.changelogEntry], today);
  await writeAtomic(changelogPath, newChangelog);

  process.stdout.write(
    `refactron document: wrote ${patch.docstrings.length} docstring(s) and updated CHANGELOG.md\n`,
  );
  return 0;
}
