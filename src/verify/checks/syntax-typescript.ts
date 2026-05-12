import * as fs from 'node:fs/promises';
import * as ts from 'typescript';
import type { GateResult } from '../../contracts.js';

function scriptKindFor(file: string): ts.ScriptKind {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (file.endsWith('.js')) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

export async function checkTypescriptSyntax(files: string[]): Promise<GateResult> {
  const t0 = Date.now();
  for (const file of files) {
    const raw = await fs.readFile(file, 'utf8');
    const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, scriptKindFor(file));
    const diags =
      (sf as unknown as { parseDiagnostics: ts.DiagnosticWithLocation[] }).parseDiagnostics ?? [];
    const d = diags[0];
    if (d) {
      const msg = ts.flattenDiagnosticMessageText(d.messageText, '\n');
      const { line, character } = sf.getLineAndCharacterOfPosition(d.start ?? 0);
      return {
        passed: false,
        durationMs: Date.now() - t0,
        blockingReason: `${file}:${line + 1}:${character + 1} — ${msg}`,
      };
    }
  }
  return { passed: true, durationMs: Date.now() - t0 };
}
