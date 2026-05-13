// src/document/engine.ts
// RefactronDocumenter — implements the locked Documenter contract.
//
// Pipeline for each verified writable change:
//   1. Look up the pre-write source (skip the file if not captured).
//   2. Slice the new content into per-symbol chunks.
//   3. For each symbol, skip when a docstring already exists; otherwise
//      build a prompt (redacted, truncated), consult the cache, and call
//      the configured LLM provider on miss. Provider errors are absorbed —
//      a single failure must never abort documentation of the rest.
//   4. Aggregate diff-line statistics and ask the provider for a CHANGELOG
//      entry. If the provider fails here, fall back to a canned line.

import type { Documenter, DocPatch, VerificationResult } from '../contracts.js';
import { type DocumenterOptions, ProviderError } from './types.js';
import { chunkByFunction } from './chunker.js';
import { hasExistingDocstring, type Language } from './idempotency.js';
import {
  CHANGELOG_TEMPLATE_VERSION,
  DOCSTRING_TEMPLATE_VERSION,
  changelogPrompt,
  docstringPrompt,
} from './prompts.js';
import { truncateToBudget } from './budget.js';
import { redact } from './redact.js';
import { cacheKey, getCached, setCached } from './cache.js';
import { countChangedLines, generateUnifiedDiff } from '../infrastructure/diff.js';

function detectLanguage(filePath: string): Language | null {
  if (filePath.endsWith('.py')) return 'python';
  if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) return 'typescript';
  return null;
}

/** Best-effort: strip a leading and/or trailing triple-backtick fence. */
function stripCodeFences(text: string): string {
  let out = text;
  // Leading ``` (optionally with a language tag) on the first line.
  out = out.replace(/^\s*```[A-Za-z0-9_-]*\s*\n?/, '');
  // Trailing fence.
  out = out.replace(/\n?```\s*$/, '');
  return out;
}

export class RefactronDocumenter implements Documenter {
  constructor(private readonly opts: DocumenterOptions) {}

  async document(verified: VerificationResult): Promise<DocPatch> {
    const docstrings: DocPatch['docstrings'] = [];

    for (const change of verified.writableChanges) {
      const oldText = this.opts.originals.get(change.path);
      if (oldText === undefined) continue;

      const language = detectLanguage(change.path);
      if (language === null) continue;

      const symbols = chunkByFunction(change.path, oldText, change.newContent);
      for (const sym of symbols) {
        if (hasExistingDocstring(language, sym.symbol, change.newContent)) continue;

        const rawPrompt = docstringPrompt({
          symbol: sym.symbol,
          language,
          oldText: sym.oldText,
          newText: sym.newText,
        });
        const prompt = truncateToBudget(
          redact(rawPrompt, this.opts.redactPatterns),
          this.opts.tokenBudget,
        );

        const key = cacheKey({
          provider: this.opts.provider.name,
          model: this.opts.model,
          templateVersion: DOCSTRING_TEMPLATE_VERSION,
          prompt,
        });

        let response: string | null = null;
        let fromCache = false;
        if (this.opts.cacheDir !== null) {
          response = await getCached(this.opts.cacheDir, key);
          fromCache = response !== null;
        }
        if (response === null) {
          try {
            response = await this.opts.provider.generate(prompt, {
              model: this.opts.model,
              maxTokens: this.opts.tokenBudget,
            });
          } catch (err) {
            // Absorb provider errors per-symbol so one bad call doesn't
            // sink the rest of the run.
            if (err instanceof ProviderError) continue;
            continue;
          }
        }

        const cleaned = stripCodeFences(response).trim();
        if (cleaned === '') continue;

        docstrings.push({ file: change.path, symbol: sym.symbol, content: cleaned });

        if (!fromCache && this.opts.cacheDir !== null) {
          await setCached(this.opts.cacheDir, key, response);
        }
      }
    }

    // ── Changelog ──────────────────────────────────────────────────────────
    const transformIds = verified.writableChanges.map((c) => c.transformId);
    const fileCount = verified.writableChanges.length;
    let added = 0;
    let removed = 0;
    for (const change of verified.writableChanges) {
      const oldText = this.opts.originals.get(change.path);
      if (oldText === undefined) continue;
      const diff = generateUnifiedDiff(change.path, oldText, change.newContent);
      const counts = countChangedLines(diff);
      added += counts.added;
      removed += counts.removed;
    }

    const rawChangelog = changelogPrompt({
      transformIds,
      fileCount,
      summaryStats: { added, removed },
    });
    const clPrompt = truncateToBudget(
      redact(rawChangelog, this.opts.redactPatterns),
      this.opts.tokenBudget,
    );
    const clKey = cacheKey({
      provider: this.opts.provider.name,
      model: this.opts.model,
      templateVersion: CHANGELOG_TEMPLATE_VERSION,
      prompt: clPrompt,
    });

    let clResponse: string | null = null;
    let clFromCache = false;
    if (this.opts.cacheDir !== null) {
      clResponse = await getCached(this.opts.cacheDir, clKey);
      clFromCache = clResponse !== null;
    }
    if (clResponse === null) {
      try {
        clResponse = await this.opts.provider.generate(clPrompt, {
          model: this.opts.model,
          maxTokens: this.opts.tokenBudget,
        });
      } catch (err) {
        const kind = err instanceof ProviderError ? err.kind : 'unknown';
        const fallback = `Documentation skipped: ${kind}. Refactor was applied and verified.`;
        return { docstrings, changelogEntry: fallback };
      }
    }

    const changelogEntry = stripCodeFences(clResponse).trim();
    if (!clFromCache && this.opts.cacheDir !== null) {
      await setCached(this.opts.cacheDir, clKey, clResponse);
    }

    return { docstrings, changelogEntry };
  }
}
