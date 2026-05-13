// src/document/prompts.ts
// Prompt templates for the documentation engine.
//
// Each template has a versioned constant so the on-disk cache (keyed by
// sha256(provider + model + templateVersion + prompt)) auto-invalidates when
// we tweak wording.

import type { TransformId } from '../contracts.js';

export const DOCSTRING_TEMPLATE_VERSION = '1';
export const CHANGELOG_TEMPLATE_VERSION = '1';

export interface DocstringInputs {
  symbol: string;
  language: 'python' | 'typescript';
  oldText: string;
  newText: string;
}

export function docstringPrompt(inp: DocstringInputs): string {
  const styleLine =
    inp.language === 'python'
      ? 'Write a Google-style Python docstring (triple-quoted) describing the function. Use Args:, Returns:, Raises: sections only if relevant.'
      : 'Write a TSDoc-style block comment (/** ... */) describing the function. Use @param and @returns tags only if relevant.';
  return [
    `You will describe what a function does, in the form of a docstring.`,
    ``,
    styleLine,
    `Describe ONLY what the function does today. Do not describe the refactor, do not narrate how the code changed, and do not mention any earlier version of the function.`,
    `Return ONLY the docstring body. Do not include the function signature or surrounding code. Do not wrap your answer in code fences.`,
    ``,
    `Function name: ${inp.symbol}`,
    `Language: ${inp.language}`,
    ``,
    `Current source:`,
    inp.newText.trimEnd(),
  ].join('\n');
}

export interface ChangelogInputs {
  transformIds: TransformId[];
  fileCount: number;
  summaryStats: { added: number; removed: number };
}

export function changelogPrompt(inp: ChangelogInputs): string {
  const transformList = [...new Set(inp.transformIds)].join(', ');
  const filesNoun = inp.fileCount === 1 ? '1 file' : `${inp.fileCount} files`;
  return [
    `Summarise the following deterministic code-modernization run in 1 to 3 short bullet points for a user-facing CHANGELOG.`,
    `Be specific. Do not editorialise. No emojis. No marketing language.`,
    `Return ONLY the bullet points (one per line, starting with "- "). No headers, no preamble.`,
    ``,
    `Transforms applied: ${transformList}`,
    `Files changed: ${filesNoun}`,
    `Lines added: ${inp.summaryStats.added}, removed: ${inp.summaryStats.removed}`,
  ].join('\n');
}
