// src/document/prompts.ts
// Prompt templates for the documentation engine.
//
// Each template has a versioned constant so the on-disk cache (keyed by
// sha256(provider + model + templateVersion + prompt)) auto-invalidates when
// we tweak wording. Every prompt opens with a unique `[REFACTRON:*]` tag line
// so the mock provider — and any dispatch — can detect the prompt type exactly.

import type { TransformId } from '../contracts.js';

export const DOCSTRING_TEMPLATE_VERSION = '3';
export const CHANGELOG_TEMPLATE_VERSION = '2';
export const INLINE_COMMENT_TEMPLATE_VERSION = '1';
export const REPORT_TEMPLATE_VERSION = '1';

// ── Docstrings ───────────────────────────────────────────────────────────────

export interface DocstringInputs {
  symbol: string;
  kind: 'function' | 'class';
  language: 'python' | 'typescript';
  oldText: string;
  newText: string;
}

export function docstringPrompt(inp: DocstringInputs): string {
  const styleLine =
    inp.language === 'python'
      ? 'Use Google style: a one-line summary, a blank line, an optional extended description, then Args:, Returns:, Raises: — include only the sections that apply.'
      : 'Use TSDoc style: a summary line, then @param / @returns / @throws tags — include only the tags that apply.';
  const example =
    inp.language === 'python'
      ? [
          'Example output (note: NO surrounding quotes):',
          'Compute the SHA-256 digest of a file, streaming it in fixed-size chunks.',
          '',
          'Args:',
          '    path: Absolute path to the file to hash.',
          'Returns:',
          '    The lowercase hexadecimal digest.',
          'Raises:',
          '    FileNotFoundError: If `path` does not exist.',
        ].join('\n')
      : [
          'Example output (note: NO /** */ delimiters):',
          'Compute the SHA-256 digest of a file, streaming it in fixed-size chunks.',
          '@param path - Absolute path to the file to hash.',
          '@returns The lowercase hexadecimal digest.',
        ].join('\n');
  return [
    `[REFACTRON:DOCSTRING]`,
    `You are a senior software engineer writing precise reference documentation.`,
    `Document exactly what this ${inp.language} ${inp.kind} does in its CURRENT form.`,
    ``,
    `Rules:`,
    `- ${styleLine}`,
    `- Describe ONLY current behaviour. Never mention refactoring, prior versions, or how the code changed.`,
    `- Be concrete and specific. Avoid filler ("this function is used to").`,
    `- Output the docstring CONTENT ONLY — prose and section tags. Do NOT include`,
    `  surrounding triple quotes, /** */, code fences, the signature, or a preamble`,
    `  like "Here is the docstring".`,
    ``,
    example,
    ``,
    `--- TASK ---`,
    `Symbol: ${inp.symbol}`,
    `Kind: ${inp.kind}`,
    `Language: ${inp.language}`,
    ``,
    `Current source:`,
    inp.newText.trimEnd(),
  ].join('\n');
}

/** One symbol in a batched docstring request. */
export interface BatchDocstringItem {
  /** Unique integer key — used to route the response back to the symbol. */
  tag: number;
  symbol: string;
  kind: 'function' | 'class';
  language: 'python' | 'typescript';
  /** The symbol's current source. */
  source: string;
}

/**
 * Document many symbols in ONE request. The response is a strict-JSON object
 * keyed by each item's integer `tag` — so a single call replaces N per-symbol
 * calls, and duplicate symbol names never collide.
 */
export function batchDocstringPrompt(items: BatchDocstringItem[]): string {
  const blocks = items.map((it) =>
    [`### tag ${it.tag} — ${it.symbol} (${it.kind}, ${it.language})`, it.source.trimEnd()].join(
      '\n',
    ),
  );
  return [
    `[REFACTRON:DOCSTRING-BATCH]`,
    `You are a senior software engineer writing precise reference documentation.`,
    `Document what EACH of the ${items.length} symbol(s) below does, in its current form.`,
    ``,
    `Rules:`,
    `- Python symbols → a Google-style docstring body; TypeScript → a TSDoc body.`,
    `- Describe ONLY current behaviour. Never mention refactoring or prior versions.`,
    `- Per symbol, output the docstring CONTENT ONLY — no surrounding triple quotes,`,
    `  no /** */, no code fences, no signature, no preamble.`,
    ``,
    `Output STRICT JSON only — an object mapping each tag (as a string) to that`,
    `symbol's docstring content. No prose outside the JSON, no code fences:`,
    `  {"1": "<docstring for tag 1>", "2": "<docstring for tag 2>"}`,
    `Use \\n for line breaks inside a docstring value.`,
    ``,
    `--- SYMBOLS ---`,
    blocks.join('\n\n'),
  ].join('\n');
}

// ── Changelog ────────────────────────────────────────────────────────────────

export interface ChangelogEntryInput {
  relPath: string;
  transformId: TransformId;
  added: number;
  removed: number;
  diffExcerpt: string;
}

export interface ChangelogInputs {
  entries: ChangelogEntryInput[];
  /** Files beyond the excerpt cap — surfaced as a trailing "+N more" note. */
  overflow: number;
}

export function changelogPrompt(inp: ChangelogInputs): string {
  const blocks = inp.entries.map((e) =>
    [
      `File: ${e.relPath}`,
      `Transform: ${e.transformId}`,
      `Lines: +${e.added} / -${e.removed}`,
      `Diff:`,
      e.diffExcerpt.trimEnd(),
    ].join('\n'),
  );
  if (inp.overflow > 0) {
    blocks.push(`(+${inp.overflow} more file(s) changed by the same transforms)`);
  }
  return [
    `[REFACTRON:CHANGELOG]`,
    `You are writing a user-facing CHANGELOG for a deterministic code-modernization tool.`,
    `Produce one specific bullet per file changed below.`,
    ``,
    `Rules:`,
    `- One line per bullet, starting with "- ".`,
    `- Name the file (relative path) and state concretely what changed. Refer to the`,
    `  transform by its human meaning, not its raw id.`,
    `- Factual and terse. No emojis, no marketing, no aggregate-only summary, no headers,`,
    `  no preamble.`,
    ``,
    `Example:`,
    `- src/auth/login.py: converted 4 %-format strings to f-strings`,
    `- src/db/pool.py: replaced the callback-style connect() with async/await`,
    ``,
    `--- CHANGES ---`,
    blocks.join('\n\n'),
  ].join('\n');
}

// ── Inline comments ──────────────────────────────────────────────────────────

export interface InlineCommentInputs {
  relPath: string;
  language: 'python' | 'typescript';
  /** The file content with 1-indexed `NNN| ` line-number prefixes. */
  numberedSource: string;
}

export function inlineCommentPrompt(inp: InlineCommentInputs): string {
  return [
    `[REFACTRON:INLINE]`,
    `You are a senior engineer adding explanatory inline comments to ${inp.language} code.`,
    `The source below has 1-indexed line numbers prefixed as "NNN| ".`,
    ``,
    `Goal: generous coverage — comment most non-trivial logic — but every comment must`,
    `add understanding. Explain intent, the "why", non-obvious control flow, edge cases,`,
    `and invariants. NEVER restate what the code literally says ("increment i"). Skip`,
    `lines that are genuinely self-explanatory.`,
    ``,
    `Output STRICT JSON only — an array, no prose, no code fences:`,
    `[{"line": <n>, "anchorContent": "<verbatim trimmed text of line n>",`,
    `  "occurrence": <1-based index if that exact text repeats, else 1>,`,
    `  "comment": ["first comment line", "second line if needed"]}]`,
    `Each comment is inserted on its OWN line(s) directly ABOVE the anchor line.`,
    `Write the comment text WITHOUT the leading ${inp.language === 'python' ? '#' : '//'} marker.`,
    ``,
    `--- SOURCE (${inp.relPath}) ---`,
    inp.numberedSource.trimEnd(),
  ].join('\n');
}

// ── Modernization report prose ───────────────────────────────────────────────

export interface ReportFileInput {
  relPath: string;
  transformId: TransformId;
  diffExcerpt: string;
}

export interface ReportProseInputs {
  files: ReportFileInput[];
}

export function reportProsePrompt(inp: ReportProseInputs): string {
  const blocks = inp.files.map((f) =>
    [`File: ${f.relPath}`, `Transform: ${f.transformId}`, `Diff:`, f.diffExcerpt.trimEnd()].join(
      '\n',
    ),
  );
  return [
    `[REFACTRON:REPORT]`,
    `You are documenting an automated, deterministic code-modernization run for engineers.`,
    `Every transform is behaviour-preserving and the result was verified (syntax, imports,`,
    `and tests all passed).`,
    ``,
    `Output STRICT JSON only — no prose outside the JSON, no code fences:`,
    `{"summary": "<2-4 sentence overview of the whole run>",`,
    ` "files": {"<relPath>": "<1-2 sentences: what changed and why it is behaviour-preserving>"}}`,
    ``,
    `Be factual and specific. Tie each explanation to the actual before/after shown.`,
    `No marketing language.`,
    ``,
    `--- CHANGES ---`,
    blocks.join('\n\n'),
  ].join('\n');
}
