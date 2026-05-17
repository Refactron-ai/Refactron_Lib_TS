// src/document/engine.ts
// RefactronDocumenter — implements the locked Documenter contract (`document`)
// and adds two non-contract capabilities the CLI orchestrates: `commentFiles`
// (inline comments) and `reportProse` (modernization-report prose).
//
// Every LLM call goes through `generate` → the CallScheduler (bounded
// concurrency + rate limiter + backoff). Docstrings are BATCHED — many symbols
// per request — so the call count is O(source tokens / batch budget), not
// O(symbols).

import * as path from 'node:path';
import type { Documenter, DocPatch, VerificationResult } from '../contracts.js';
import type { DocumenterOptions } from './types.js';
import { chunkByFunction } from './chunker.js';
import { hasExistingDocstring, type Language } from './idempotency.js';
import {
  CHANGELOG_TEMPLATE_VERSION,
  DOCSTRING_TEMPLATE_VERSION,
  INLINE_COMMENT_TEMPLATE_VERSION,
  REPORT_TEMPLATE_VERSION,
  batchDocstringPrompt,
  changelogPrompt,
  inlineCommentPrompt,
  reportProsePrompt,
  type BatchDocstringItem,
  type ChangelogEntryInput,
  type ReportFileInput,
} from './prompts.js';
import { normalizeDocstringContent } from './apply.js';
import {
  numberSource,
  parseRawComments,
  resolveComments,
  type InlineCommentPatch,
} from './inline-comments.js';
import { parseReportProse, type ReportProse } from './report.js';
import { truncateToBudget } from './budget.js';
import { redact } from './redact.js';
import { cacheKey, getCached, setCached } from './cache.js';
import { CallScheduler, DEFAULT_SCHEDULER } from './scheduler.js';
import { countChangedLines, generateUnifiedDiff } from '../infrastructure/diff.js';

/** Files past this count fold into a "+N more" overflow note in the prompt. */
const CHANGELOG_ENTRY_CAP = 12;

/** Sentinel prefix the CLI uses to detect a total provider outage. */
const SKIPPED_SENTINEL = 'Documentation skipped:';

function detectLanguage(filePath: string): Language | null {
  if (filePath.endsWith('.py')) return 'python';
  if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) return 'typescript';
  return null;
}

/** Best-effort: strip a leading and/or trailing triple-backtick fence. */
function stripCodeFences(text: string): string {
  return text.replace(/^\s*```[A-Za-z0-9_-]*\s*\n?/, '').replace(/\n?```\s*$/, '');
}

/** Compact a unified diff to its first ~25 body lines for prompt context. */
function diffExcerpt(diff: string): string {
  return diff
    .split('\n')
    .filter((l) => !l.startsWith('+++') && !l.startsWith('---') && !l.startsWith('==='))
    .slice(0, 25)
    .join('\n');
}

/** Rough token estimate — the same 4-chars-per-token heuristic budget.ts uses. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

interface PendingSymbol {
  file: string;
  language: Language;
  symbol: string;
  kind: 'function' | 'class';
  source: string;
}

/** Parse the batched-docstring strict-JSON response → Map<tag, docstring>. */
export function parseBatchDocstrings(raw: string): Map<number, string> {
  const out = new Map<number, string>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    return out;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return out;
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    const tag = Number(k);
    if (Number.isInteger(tag) && typeof v === 'string') out.set(tag, v);
  }
  return out;
}

/** A no-LLM changelog, synthesized from the per-file diff stats. */
function deterministicChangelog(entries: ChangelogEntryInput[]): string {
  if (entries.length === 0) return '- Applied automated modernization transforms.';
  return entries
    .map((e) => `- ${e.relPath}: ${e.transformId} (+${e.added} / -${e.removed})`)
    .join('\n');
}

export class RefactronDocumenter implements Documenter {
  private readonly scheduler: CallScheduler;
  private readonly batchTokenBudget: number;
  /** Generous prompt-truncation cap — won't fire for properly-packed batches. */
  private readonly promptCap: number;

  constructor(private readonly opts: DocumenterOptions) {
    this.scheduler = new CallScheduler(opts.scheduler ?? DEFAULT_SCHEDULER);
    this.batchTokenBudget = opts.batchTokenBudget ?? 4000;
    this.promptCap = Math.max(opts.tokenBudget, this.batchTokenBudget) + 2000;
  }

  /**
   * Redact → truncate → cache lookup → scheduled provider call → cache store.
   * The scheduler bounds concurrency, paces requests, and backs off on rate
   * limits. Throws ProviderError when a call still fails after backoff.
   */
  private async generate(rawPrompt: string, templateVersion: string): Promise<string> {
    const prompt = truncateToBudget(redact(rawPrompt, this.opts.redactPatterns), this.promptCap);
    const key = cacheKey({
      provider: this.opts.provider.name,
      model: this.opts.model,
      templateVersion,
      prompt,
    });
    if (this.opts.cacheDir !== null) {
      const cached = await getCached(this.opts.cacheDir, key);
      if (cached !== null) return cached;
    }
    // Pace against the tokens-per-minute budget — the limit batched requests
    // actually hit. Estimate = prompt tokens + the completion cap.
    const estimatedTokens = Math.ceil(prompt.length / 4) + this.opts.tokenBudget;
    const response = await this.scheduler.run(
      () =>
        this.opts.provider.generate(prompt, {
          model: this.opts.model,
          maxTokens: this.opts.tokenBudget,
        }),
      estimatedTokens,
    );
    if (this.opts.cacheDir !== null) {
      await setCached(this.opts.cacheDir, key, response);
    }
    return response;
  }

  // ── Documenter contract ────────────────────────────────────────────────────

  async document(verified: VerificationResult): Promise<DocPatch> {
    // 1. Collect every symbol that still needs a docstring.
    const pending: PendingSymbol[] = [];
    for (const change of verified.writableChanges) {
      const oldText = this.opts.originals.get(change.path);
      if (oldText === undefined) continue;
      const language = detectLanguage(change.path);
      if (language === null) continue;
      for (const sym of chunkByFunction(change.path, oldText, change.newContent)) {
        if (hasExistingDocstring(language, sym.symbol, change.newContent)) continue;
        pending.push({
          file: change.path,
          language,
          symbol: sym.symbol,
          kind: sym.kind,
          source: sym.newText,
        });
      }
    }

    // 2. Pack into token-bounded batches (deterministic — re-runs hit cache).
    const batches: Array<Array<BatchDocstringItem & { file: string; language: Language }>> = [];
    let current: Array<BatchDocstringItem & { file: string; language: Language }> = [];
    let currentTokens = 0;
    pending.forEach((p, tag) => {
      const item = {
        tag,
        symbol: p.symbol,
        kind: p.kind,
        language: p.language,
        source: p.source,
        file: p.file,
      };
      const tokens = estimateTokens(p.source);
      if (current.length > 0 && currentTokens + tokens > this.batchTokenBudget) {
        batches.push(current);
        current = [];
        currentTokens = 0;
      }
      current.push(item);
      currentTokens += tokens;
    });
    if (current.length > 0) batches.push(current);

    // 3. Run the batches (the scheduler bounds concurrency).
    const docstrings: DocPatch['docstrings'] = [];
    let providerFailures = 0;
    await Promise.all(
      batches.map(async (batch) => {
        let response: string;
        try {
          response = await this.generate(batchDocstringPrompt(batch), DOCSTRING_TEMPLATE_VERSION);
        } catch {
          providerFailures++;
          return; // this batch's symbols simply get no docstring
        }
        const parsed = parseBatchDocstrings(stripCodeFences(response));
        for (const item of batch) {
          const raw = parsed.get(item.tag);
          if (raw === undefined) continue;
          const cleaned = normalizeDocstringContent(item.language, stripCodeFences(raw).trim());
          if (cleaned !== '') {
            docstrings.push({ file: item.file, symbol: item.symbol, content: cleaned });
          }
        }
      }),
    );

    // 4. Changelog — one entry per file; LLM prose with a deterministic fallback.
    const entries: ChangelogEntryInput[] = [];
    for (const change of verified.writableChanges) {
      const oldText = this.opts.originals.get(change.path);
      if (oldText === undefined) continue;
      const relPath = path.relative(this.opts.projectRoot, change.path) || change.path;
      const diff = generateUnifiedDiff(relPath, oldText, change.newContent);
      const counts = countChangedLines(diff);
      entries.push({
        relPath,
        transformId: change.transformId,
        added: counts.added,
        removed: counts.removed,
        diffExcerpt: diffExcerpt(diff),
      });
    }
    const capped = entries.slice(0, CHANGELOG_ENTRY_CAP);
    let changelogEntry: string;
    try {
      const response = await this.generate(
        changelogPrompt({ entries: capped, overflow: entries.length - capped.length }),
        CHANGELOG_TEMPLATE_VERSION,
      );
      changelogEntry = stripCodeFences(response).trim() || deterministicChangelog(entries);
    } catch {
      // A throttled/failed changelog call no longer aborts the run — fall back
      // to a deterministic, no-LLM changelog synthesized from the diff stats.
      changelogEntry = deterministicChangelog(entries);
    }

    // Total-outage signal: symbols existed, none got documented, calls failed.
    // The CLI treats this as "provider unreachable" and writes nothing.
    if (pending.length > 0 && docstrings.length === 0 && providerFailures > 0) {
      return {
        docstrings,
        changelogEntry: `${SKIPPED_SENTINEL} the LLM provider could not be reached.`,
      };
    }
    return { docstrings, changelogEntry };
  }

  // ── Inline comments (non-contract) ─────────────────────────────────────────

  async commentFiles(verified: VerificationResult): Promise<InlineCommentPatch> {
    const targets = verified.writableChanges
      .map((change) => ({ change, language: detectLanguage(change.path) }))
      .filter(
        (t): t is { change: (typeof verified.writableChanges)[number]; language: Language } =>
          t.language !== null,
      );

    const files: InlineCommentPatch['files'] = [];
    let dropped = 0;
    await Promise.all(
      targets.map(async ({ change, language }) => {
        let response: string;
        try {
          response = await this.generate(
            inlineCommentPrompt({
              relPath: path.relative(this.opts.projectRoot, change.path) || change.path,
              language,
              numberedSource: numberSource(change.newContent),
            }),
            INLINE_COMMENT_TEMPLATE_VERSION,
          );
        } catch {
          return; // skip this file's comments; never sink the run
        }
        const resolved = resolveComments(
          language,
          change.newContent,
          parseRawComments(stripCodeFences(response)),
        );
        dropped += resolved.dropped;
        if (resolved.insertions.length > 0) {
          files.push({ file: change.path, insertions: resolved.insertions });
        }
      }),
    );
    return { files, dropped };
  }

  // ── Modernization-report prose (non-contract) ──────────────────────────────

  async reportProse(files: ReportFileInput[]): Promise<ReportProse> {
    if (files.length === 0) return { summary: '', files: {} };
    try {
      const response = await this.generate(reportProsePrompt({ files }), REPORT_TEMPLATE_VERSION);
      return parseReportProse(stripCodeFences(response));
    } catch {
      return { summary: '', files: {} };
    }
  }
}
