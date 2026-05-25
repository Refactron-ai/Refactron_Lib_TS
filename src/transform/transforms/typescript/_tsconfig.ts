// src/transform/transforms/typescript/_tsconfig.ts
//
// Resolves the effective `compilerOptions.target` from a project's
// tsconfig.json so version-gated TypeScript transforms can refuse to rewrite
// when the requested ES idiom isn't available on the target.
//
// Why this lives here and not under src/cli/: it is a *transform-side*
// concern — a transform asks "what's the target?" and refuses if the target
// is too old. It does not influence config validation or CLI surface.
//
// Caching: per `projectRoot` via a module-level Map, keyed by the resolved
// absolute path of the project root. Reads (and the `extends` chain walk) are
// synchronous because ts-morph transforms run synchronously inside
// `withProject` callbacks. A first miss reads from disk; every subsequent
// transform call for the same project root reuses the cached value.
//
// `extends` chain: resolved recursively with a small visited-set guard so a
// pathological circular extends chain can't loop.

import * as fs from 'node:fs';
import * as path from 'node:path';

/** Ordered ascending. The first entry is the oldest target we model. */
export const TSCONFIG_TARGETS = [
  'es3',
  'es5',
  'es6',
  'es2015',
  'es2016',
  'es2017',
  'es2018',
  'es2019',
  'es2020',
  'es2021',
  'es2022',
  'es2023',
  'es2024',
  'esnext',
] as const;

export type TsConfigTarget = (typeof TSCONFIG_TARGETS)[number];

// `es6` is an alias for `es2015` per the TS compiler. Normalise so callers
// can compare ranks reliably.
const TARGET_RANK: Record<TsConfigTarget, number> = {
  es3: 0,
  es5: 1,
  es6: 2,
  es2015: 2,
  es2016: 3,
  es2017: 4,
  es2018: 5,
  es2019: 6,
  es2020: 7,
  es2021: 8,
  es2022: 9,
  es2023: 10,
  es2024: 11,
  esnext: 99,
};

/** Returns true when `target` is at least as new as `minimum`. */
export function targetAtLeast(target: TsConfigTarget, minimum: TsConfigTarget): boolean {
  return TARGET_RANK[target] >= TARGET_RANK[minimum];
}

interface CacheEntry {
  target: TsConfigTarget | null;
}

const CACHE = new Map<string, CacheEntry>();

/** Test-only: clear the per-projectRoot cache. */
export function _clearTsConfigCache(): void {
  CACHE.clear();
}

function normaliseTarget(raw: string): TsConfigTarget | null {
  const lower = raw.trim().toLowerCase();
  if ((TSCONFIG_TARGETS as readonly string[]).includes(lower)) {
    return lower as TsConfigTarget;
  }
  return null;
}

/**
 * Strip /* … *\/ and // … comments and trailing commas from a tsconfig.json
 * blob. Real tsconfig.json files routinely include both and JSON.parse rejects
 * them. We don't pull in a full JSONC parser to avoid widening the dep
 * surface; this regex sweep handles every case we've seen in the wild.
 *
 * NOTE: this is intentionally conservative — it does not try to honour
 * comment markers inside strings (rare in tsconfig.json and the round-trip
 * cost of getting that right with a regex isn't worth it for our use case).
 */
function stripJsonc(input: string): string {
  // Block comments.
  let out = input.replace(/\/\*[\s\S]*?\*\//g, '');
  // Line comments.
  out = out.replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  // Trailing commas before `}` or `]`.
  out = out.replace(/,(\s*[}\]])/g, '$1');
  return out;
}

/**
 * Resolve a tsconfig `extends` reference relative to the file that declared
 * it. Mirrors the TS compiler's resolution order in the common cases:
 *   - "./base"               → ./base.json next to the parent
 *   - "../tsconfig.base"     → ../tsconfig.base.json next to the parent
 *   - "@foo/tsconfig"        → node_modules/@foo/tsconfig/tsconfig.json
 *
 * We do NOT implement full package.json `exports` resolution — that is rare
 * in tsconfig extends chains and the failure mode (silent "target unknown")
 * is the safe one for our use case.
 */
function resolveExtends(fromFile: string, ext: string): string | null {
  const fromDir = path.dirname(fromFile);
  // Relative or absolute path.
  if (ext.startsWith('./') || ext.startsWith('../') || path.isAbsolute(ext)) {
    const candidates = ext.endsWith('.json') ? [ext] : [`${ext}.json`, `${ext}/tsconfig.json`];
    for (const c of candidates) {
      const abs = path.isAbsolute(c) ? c : path.resolve(fromDir, c);
      if (fs.existsSync(abs)) return abs;
    }
    return null;
  }
  // Bare specifier → node_modules.
  let dir = fromDir;
  const root = path.parse(dir).root;
  for (;;) {
    const candidate = ext.endsWith('.json')
      ? path.join(dir, 'node_modules', ext)
      : path.join(dir, 'node_modules', ext, 'tsconfig.json');
    if (fs.existsSync(candidate)) return candidate;
    if (dir === root) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

interface RawTsConfig {
  compilerOptions?: { target?: string };
  extends?: string | string[];
}

function readTsConfig(filePath: string): RawTsConfig | null {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
  try {
    return JSON.parse(stripJsonc(raw)) as RawTsConfig;
  } catch {
    return null;
  }
}

/**
 * Walk the `extends` chain from a single file (NO array handling): follows
 * `string`-valued `extends` toward the base. Returns the first
 * `compilerOptions.target` found. Mutates the shared `visited` set so callers
 * can prevent revisits across sibling array branches.
 *
 * Stops (returns null) when:
 *   - a file can't be read/parsed,
 *   - the chain ends with no target,
 *   - the chain hits an array `extends` (delegated to the caller),
 *   - a node has already been visited (cycle guard).
 */
function resolveTargetFromSingleChain(
  startPath: string,
  visited: Set<string>,
): { target: TsConfigTarget | null; arrayHead: { file: string; entries: string[] } | null } {
  let current: string | null = startPath;
  while (current && !visited.has(current)) {
    visited.add(current);
    const cfg = readTsConfig(current);
    if (!cfg) return { target: null, arrayHead: null };
    const t = cfg.compilerOptions?.target;
    if (typeof t === 'string') {
      const norm = normaliseTarget(t);
      if (norm) return { target: norm, arrayHead: null };
    }
    const ext = cfg.extends;
    if (typeof ext === 'string') {
      current = resolveExtends(current, ext);
    } else if (Array.isArray(ext) && ext.length > 0) {
      // Surface the array to the caller — it will iterate each entry and
      // re-enter the single-chain walk for each one with the shared visited
      // set to prevent revisits.
      const entries = ext.filter((e): e is string => typeof e === 'string');
      return { target: null, arrayHead: { file: current, entries } };
    } else {
      current = null;
    }
  }
  return { target: null, arrayHead: null };
}

/**
 * Walk the `extends` chain and return the first `compilerOptions.target` we
 * find, starting at `filePath` and following each `extends` toward its base.
 * The CHILD's target wins over its parent, which matches the TS compiler.
 *
 * Cycle guard: a single shared visited-set is threaded through every chain
 * (including each branch of an array `extends`) so a diamond or a cycle can't
 * loop or revisit a node.
 *
 * Array-extends semantics (TS 5.0+): when we encounter an `extends` array,
 * iterate each entry in order and re-enter the chain walk for each. We return
 * the FIRST non-null target found across all entries. NOTE: TypeScript's
 * actual merge semantics for array-extends are LAST-WINS (later entries
 * override earlier), but for v0.3.0 we deliberately use "first non-null" —
 * matching the historic comment — which is the conservative-toward-refusal
 * direction (any lower-target base in the array still gates the transform).
 */
function resolveTargetFromFile(filePath: string): TsConfigTarget | null {
  const visited = new Set<string>();
  const stack: string[] = [filePath];
  while (stack.length > 0) {
    const start = stack.shift()!;
    if (visited.has(start)) continue;
    const { target, arrayHead } = resolveTargetFromSingleChain(start, visited);
    if (target) return target;
    if (arrayHead) {
      const resolvedEntries: string[] = [];
      for (const e of arrayHead.entries) {
        const resolved = resolveExtends(arrayHead.file, e);
        if (resolved) resolvedEntries.push(resolved);
      }
      // Push entries to the front so we exhaust this array's branches before
      // any deferred ones (BFS-by-array-group). The shared visited-set
      // prevents diamond/cycle revisits.
      stack.unshift(...resolvedEntries);
    }
  }
  return null;
}

/**
 * Walk up from `startDir` looking for a tsconfig.json. Returns the absolute
 * path of the first one found, or `null`.
 */
function findTsConfig(startDir: string): string | null {
  let dir = startDir;
  const root = path.parse(dir).root;
  for (;;) {
    const candidate = path.join(dir, 'tsconfig.json');
    if (fs.existsSync(candidate)) return candidate;
    if (dir === root) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Resolve the project's `compilerOptions.target`. Returns `null` when no
 * tsconfig.json is reachable or no target is set in the extends chain — the
 * permissive default ("assume modern"). Callers gate transforms by comparing
 * against `targetAtLeast(target, 'es2016')` etc.
 *
 * `projectRoot` is used as the cache key AND as the starting point for the
 * tsconfig search. `absPath` is the fallback start when projectRoot is
 * missing — we walk up from the file's directory.
 */
export function resolveTsConfigTarget(opts: {
  projectRoot?: string | undefined;
  absPath: string;
}): TsConfigTarget | null {
  const cacheKey = opts.projectRoot ?? path.dirname(opts.absPath);
  const cached = CACHE.get(cacheKey);
  if (cached) return cached.target;

  const startDir = opts.projectRoot ?? path.dirname(opts.absPath);
  const configPath = findTsConfig(startDir);
  const target = configPath ? resolveTargetFromFile(configPath) : null;
  CACHE.set(cacheKey, { target });
  return target;
}
