// src/document/engine.ts
// RefactronDocumenter — implements the locked Documenter contract (`document`)
// and adds two non-contract capabilities the CLI orchestrates: `commentFiles`
// (inline comments) and `reportProse` (modernization-report prose).
//
// Every LLM call goes through the private `generate` helper: redact → truncate
// → cache lookup → provider call → cache store. Provider errors propagate as
// ProviderError so each caller decides how to degrade.

import * as path from 'node:path';
import type { Documenter, DocPatch, VerificationResult } from '../contracts.js';
import { type DocumenterOptions, ProviderError } from './types.js';
import { chunkByFunction } from './chunker.js';
import { hasExistingDocstring, type Language } from './idempotency.js';
import {
  CHANGELOG_TEMPLATE_VERSION,
  DOCSTRING_TEMPLATE_VERSION,
  INLINE_COMMENT_TEMPLATE_VERSION,
  REPORT_TEMPLATE_VERSION,
  changelogPrompt,
  docstringPrompt,
  inlineCommentPrompt,
  reportProsePrompt,
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
import { countChangedLines, generateUnifiedDiff } from '../infrastructure/diff.js';

/** Files past this count fold into a "+N more" overflow note in the prompt. */
const CHANGELOG_ENTRY_CAP = 12;

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

export class RefactronDocumenter implements Documenter {
  constructor(private readonly opts: DocumenterOptions) {}

  /**
   * Redact → truncate → cache lookup → provider call → cache store.
   * Throws ProviderError when a cache-miss call is rejected by the provider.
   */
  private async generate(rawPrompt: string, templateVersion: string): Promise<string> {
    const prompt = truncateToBudget(
      redact(rawPrompt, this.opts.redactPatterns),
      this.opts.tokenBudget,
    );
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
    const response = await this.opts.provider.generate(prompt, {
      model: this.opts.model,
      maxTokens: this.opts.tokenBudget,
    });
    if (this.opts.cacheDir !== null) {
      await setCached(this.opts.cacheDir, key, response);
    }
    return response;
  }

  // ── Documenter contract ────────────────────────────────────────────────────

  async document(verified: VerificationResult): Promise<DocPatch> {
    const docstrings: DocPatch['docstrings'] = [];

    for (const change of verified.writableChanges) {
      const oldText = this.opts.originals.get(change.path);
      if (oldText === undefined) continue;
      const language = detectLanguage(change.path);
      if (language === null) continue;

      for (const sym of chunkByFunction(change.path, oldText, change.newContent)) {
        if (hasExistingDocstring(language, sym.symbol, change.newContent)) continue;

        let response: string;
        try {
          response = await this.generate(
            docstringPrompt({
              symbol: sym.symbol,
              kind: sym.kind,
              language,
              oldText: sym.oldText,
              newText: sym.newText,
            }),
            DOCSTRING_TEMPLATE_VERSION,
          );
        } catch {
          // Absorb provider errors per symbol — one bad call must not sink
          // documentation of the rest.
          continue;
        }

        const cleaned = normalizeDocstringContent(language, stripCodeFences(response).trim());
        if (cleaned === '') continue;
        docstrings.push({ file: change.path, symbol: sym.symbol, content: cleaned });
      }
    }

    // ── Changelog — one entry per file so the model writes a specific bullet ──
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
      changelogEntry = stripCodeFences(response).trim();
    } catch (err) {
      const kind = err instanceof ProviderError ? err.kind : 'unknown';
      changelogEntry = `Documentation skipped: ${kind}. Refactor was applied and verified.`;
    }

    return { docstrings, changelogEntry };
  }

  // ── Inline comments (non-contract) ─────────────────────────────────────────

  async commentFiles(verified: VerificationResult): Promise<InlineCommentPatch> {
    const files: InlineCommentPatch['files'] = [];
    let dropped = 0;

    for (const change of verified.writableChanges) {
      const language = detectLanguage(change.path);
      if (language === null) continue;

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
        continue; // skip this file's comments; never sink the run
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
    }
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
