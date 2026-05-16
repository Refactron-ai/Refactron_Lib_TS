// src/cli/report-file.ts
// Persists a rendered command report (analyze / dry-run) to a plain-text file
// under .refactron/reports/. A large run prints more lines than the terminal's
// scrollback can keep — the saved file is the durable, fully-scrollable copy.

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { RenderedLine } from './format-types.js';

export interface WriteReportParams {
  /** Project root — .refactron/ lives here (matches WorkSessionManager). */
  projectRoot: string;
  /** Command that produced the report — e.g. 'analyze' | 'dry-run'. */
  command: string;
  /** Work-session id, used in the filename. */
  sessionId: string;
  /** The rendered lines streamed to the terminal. */
  lines: RenderedLine[];
}

/**
 * Write the rendered report to `.refactron/reports/<command>-<id>.txt`.
 * Colors are dropped — the file is plain text. Returns the absolute path.
 */
export async function writeRenderedReport(p: WriteReportParams): Promise<string> {
  const dir = path.join(p.projectRoot, '.refactron', 'reports');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${p.command}-${p.sessionId}.txt`);
  const header =
    `refactron ${p.command} — ${p.projectRoot}\n` + `generated ${new Date().toISOString()}\n\n`;
  const body = p.lines.map((l) => l.text).join('\n');
  await fs.writeFile(file, `${header}${body}\n`, 'utf8');
  return file;
}

/** A path for display: relative to cwd when inside it, else absolute. */
export function displayReportPath(absPath: string): string {
  const rel = path.relative(process.cwd(), absPath);
  return rel === '' || rel.startsWith('..') ? absPath : rel;
}
