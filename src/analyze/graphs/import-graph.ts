import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type Parser from 'tree-sitter';
import { parsePython, parseTypescript } from '../parser.js';
import type { FileRecord } from '../discovery.js';

export type ImportGraph = Map<string, Set<string>>;

const TS_EXTS = ['.ts', '.tsx', '.js', '.jsx'] as const;

function pyResolve(_root: string, _sourceRel: string, modName: string): string | null {
  // Top-level modules: `<modName>.py` resolved at project root.
  return `${modName.replace(/\./g, '/')}.py`;
}

function tsResolve(_root: string, sourceRel: string, spec: string): string[] {
  if (!spec.startsWith('.')) return [];
  const cleaned = spec.replace(/\.js$/, '');
  const baseDir = path.dirname(sourceRel);
  const out: string[] = [];
  for (const ext of TS_EXTS) {
    out.push(path.posix.normalize(path.posix.join(baseDir, cleaned)) + ext);
  }
  return out;
}

function pyImports(source: string): string[] {
  const tree = parsePython(source);
  const out: string[] = [];
  function visit(n: Parser.SyntaxNode): void {
    if (n.type === 'import_statement') {
      for (const c of n.namedChildren) {
        let name: string | null = null;
        if (c.type === 'dotted_name') {
          name = c.text;
        } else if (c.type === 'aliased_import') {
          name = c.childForFieldName('name')?.text ?? null;
        }
        if (name) out.push(name);
      }
    }
    if (n.type === 'import_from_statement') {
      const mod = n.childForFieldName('module_name');
      if (mod) out.push(mod.text);
    }
    for (const ch of n.namedChildren) visit(ch);
  }
  visit(tree.rootNode);
  return out;
}

function tsImports(source: string, tsx: boolean): string[] {
  const tree = parseTypescript(source, tsx);
  const out: string[] = [];
  function visit(n: Parser.SyntaxNode): void {
    if (n.type === 'import_statement') {
      const spec = n.childForFieldName('source');
      if (spec?.type === 'string') {
        out.push(spec.text.slice(1, -1));
      }
    }
    if (n.type === 'call_expression') {
      const fn = n.childForFieldName('function');
      if (fn?.type === 'identifier' && fn.text === 'require') {
        const arg = n.childForFieldName('arguments')?.namedChild(0);
        if (arg?.type === 'string') out.push(arg.text.slice(1, -1));
      }
    }
    for (const c of n.namedChildren) visit(c);
  }
  visit(tree.rootNode);
  return out;
}

export async function buildImportGraph(
  root: string,
  files: FileRecord[],
): Promise<ImportGraph> {
  const known = new Set(files.map((f) => f.relPath));
  const graph: ImportGraph = new Map();
  for (const f of files) {
    const source = await fs.readFile(f.absPath, 'utf8');
    const candidates: string[] = [];
    if (f.lang === 'python') {
      const mods = pyImports(source);
      for (const m of mods) {
        const resolved = pyResolve(root, f.relPath, m);
        if (resolved && known.has(resolved)) candidates.push(resolved);
      }
    } else {
      const tsx = f.relPath.endsWith('.tsx');
      const specs = tsImports(source, tsx);
      for (const s of specs) {
        for (const resolved of tsResolve(root, f.relPath, s)) {
          if (known.has(resolved)) {
            candidates.push(resolved);
            break;
          }
        }
      }
    }
    graph.set(f.relPath, new Set(candidates));
  }
  return graph;
}
