import * as path from 'node:path';
import { Project, ScriptKind, ScriptTarget, type SourceFile } from 'ts-morph';

export interface TsPrecondition {
  id: string;
  satisfied: boolean;
  reason?: string;
}

export interface TsRunResult {
  newContent: string | null;
  preconditions: TsPrecondition[];
}

export function scriptKindFor(file: string): ScriptKind {
  const ext = path.extname(file).toLowerCase();
  switch (ext) {
    case '.tsx':
      return ScriptKind.TSX;
    case '.jsx':
      return ScriptKind.JSX;
    case '.js':
      return ScriptKind.JS;
    case '.ts':
    default:
      return ScriptKind.TS;
  }
}

export interface TsTransformFnResult {
  changed: boolean;
  preconditions: TsPrecondition[];
}

/**
 * Creates a fresh ts-morph Project per call (per ADR-001 R3: avoid stale-node hazards
 * across files/runs). Loads `source` as an in-memory SourceFile named after `absPath`,
 * runs `fn(sf)`, and returns the rewritten content if `fn` reports a change.
 */
export function withProject(
  absPath: string,
  source: string,
  fn: (sf: SourceFile) => TsTransformFnResult,
): TsRunResult {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: {
      target: ScriptTarget.Latest,
      allowJs: true,
      noEmit: true,
    },
  });
  const fileName = path.basename(absPath);
  const sf = project.createSourceFile(fileName, source, {
    scriptKind: scriptKindFor(absPath),
    overwrite: true,
  });
  const { changed, preconditions } = fn(sf);
  if (!changed) {
    return { newContent: null, preconditions };
  }
  return { newContent: sf.getFullText(), preconditions };
}
