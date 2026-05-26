// src/cli/config-loader.ts
// Loads `.refactronrc` configuration via cosmiconfig and validates it against a
// JSON Schema 7 schema with Ajv 8. Flags always override values from disk.
import { cosmiconfig } from 'cosmiconfig';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import Ajv from 'ajv';
import type { ValidateFunction } from 'ajv';

/** The set of Python versions the v0.2.3 transforms understand. We deliberately
 *  stop at `3.13` because anything newer than that has no version-gated
 *  transform yet — the next time we add a `>= 3.14` transform we extend this
 *  list and the schema enum in lock-step. */
export const SUPPORTED_PYTHON_VERSIONS = ['3.8', '3.9', '3.10', '3.11', '3.12', '3.13'] as const;
export type PythonVersionString = (typeof SUPPORTED_PYTHON_VERSIONS)[number];

export interface DocumentationConfig {
  provider: 'ollama' | 'openai' | 'anthropic' | 'groq' | 'backend';
  model: string;
  endpoint: string | null;
  tokenBudget: number;
  redactPatterns: string[];
  cache: boolean;
  /** Max LLM requests in flight at once. */
  maxConcurrency: number;
  /** Soft cap on LLM requests started per minute. */
  requestsPerMinute: number;
  /** Soft cap on (estimated) tokens started per minute — the binding limit on
   *  most free tiers. Raise it for a paid tier / local Ollama. */
  tokensPerMinute: number;
  /** Source-token budget per batched docstring request — bigger = fewer calls,
   *  but each call costs more tokens-per-minute. */
  batchTokenBudget: number;
}

export interface RefactronRc {
  transforms: string[]; // 'all' or TransformId values
  exclude: string[];
  testCmd: string | null;
  confidence: 'high' | 'medium' | 'low';
  dryRun: boolean;
  documentation: DocumentationConfig;
  /** Minimum Python version the project targets (e.g. "3.9"). Optional.
   *  When unset, the v2.1 `pythonVersion` resolver auto-detects from
   *  `pyproject.toml`'s `requires-python` (or `[tool.poetry] python`). When
   *  neither is set, version-gated transforms default-conservative: they
   *  refuse to rewrite rather than guess. */
  pythonVersion: PythonVersionString | null;
}

const VALID_TRANSFORMS = [
  'all',
  'callback_to_async_await',
  'format_to_fstring',
  'manual_typecheck_to_hints',
  'deprecated_api_requests_to_httpx',
  'class_to_dataclass',
  'var_to_const_let',
  'promise_chains_to_async',
  'implicit_any',
  'commonjs_to_esm',
  'promise_constructor_to_async',
  // v0.2.3 additions
  'super_no_args',
  'lru_cache_to_cache',
  'pep585_generics',
  'pep604_optional_union',
  'datetime_utc_alias',
  'yield_from_for_loop',
  // v0.2.3 Phase 4 — TypeScript ES2015+/ES2016+ idiom rewrites
  'indexof_to_includes',
  'object_assign_to_spread',
  'string_concat_to_template_literal',
  // v0.2.3 Phase 5 — Vue 2 reactivity-helper rewrites (.js/.ts only)
  'vue_set_delete_to_assignment',
] as const;

// Default to the Refactron-managed backend so authenticated users get
// working documentation out of the box without installing Ollama or paying
// for a third-party LLM API key. Free-tier users will hit a 402 with a
// clear "requires Pro plan" message and can opt back to Ollama (free,
// local) or Groq (free tier available, BYOK) by overriding `provider` in
// `.refactronrc.json`. Ollama-as-default was the Week 6 choice but in
// practice "documentation silently skipped" was the most common first-run
// experience because most users don't have Ollama installed.
//
// `endpoint: null` means "use the api_base_url from the user's stored
// Refactron credentials" — typically https://api.refactron.dev. The
// BackendLLMProvider constructor handles the fallback.
const DOCS_DEFAULT: DocumentationConfig = {
  provider: 'backend',
  model: 'llama-3.3-70b-versatile',
  endpoint: null,
  tokenBudget: 4000,
  redactPatterns: [],
  cache: true,
  maxConcurrency: 4,
  requestsPerMinute: 25,
  tokensPerMinute: 200000,
  batchTokenBudget: 4000,
};

const DEFAULTS: RefactronRc = {
  transforms: ['all'],
  exclude: [],
  testCmd: null,
  confidence: 'high',
  dryRun: true,
  documentation: DOCS_DEFAULT,
  pythonVersion: null,
};

const DOCS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    provider: { type: 'string', enum: ['ollama', 'openai', 'anthropic', 'groq', 'backend'] },
    model: { type: 'string' },
    endpoint: { type: ['string', 'null'] },
    tokenBudget: { type: 'integer', minimum: 256, maximum: 32000 },
    redactPatterns: { type: 'array', items: { type: 'string' } },
    cache: { type: 'boolean' },
    maxConcurrency: { type: 'integer', minimum: 1, maximum: 32 },
    requestsPerMinute: { type: 'integer', minimum: 1, maximum: 10000 },
    tokensPerMinute: { type: 'integer', minimum: 500, maximum: 10000000 },
    batchTokenBudget: { type: 'integer', minimum: 500, maximum: 64000 },
  },
};

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    transforms: { type: 'array', items: { type: 'string', enum: VALID_TRANSFORMS } },
    exclude: { type: 'array', items: { type: 'string' } },
    testCmd: { type: ['string', 'null'] },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    dryRun: { type: 'boolean' },
    documentation: DOCS_SCHEMA,
    pythonVersion: {
      type: ['string', 'null'],
      enum: [...SUPPORTED_PYTHON_VERSIONS, null],
    },
  },
};

// Ajv 8 ships a CJS default export. Under Node16 module resolution the namespace
// import (`import Ajv from 'ajv'`) resolves to a callable constructor at runtime
// but TS sometimes types it as a namespace object. Cast to a constructor type.
const AjvCtor = Ajv as unknown as new (opts?: { allErrors?: boolean }) => {
  compile: (schema: object) => ValidateFunction;
  errorsText: (errs: unknown, opts?: { separator?: string }) => string;
};
const ajv = new AjvCtor({ allErrors: true });
const validate = ajv.compile(SCHEMA);

/** Parse a PEP 440-ish requires-python spec into a minimum (major, minor)
 *  tuple. Accepts the common Poetry / PEP 621 forms:
 *
 *  - `">=3.10"` / `">= 3.10.4"` → (3, 10)
 *  - `"^3.11"` / `"~3.11"`     → (3, 11)
 *  - `">=3.9,<4"`              → (3, 9)
 *  - `"3.12"` (Poetry shorthand) → (3, 12)
 *
 *  We deliberately ignore upper bounds: the lowest supported version is the
 *  one a version-gated transform must honour. Returns `null` when no minimum
 *  can be recovered. */
export function parseRequiresPythonMin(spec: string): [number, number] | null {
  const trimmed = spec.trim();
  if (!trimmed) return null;
  // Plain version like "3.10" / "3.10.4" — Poetry shorthand.
  const plain = trimmed.match(/^(\d+)\.(\d+)(?:\.\d+)?$/);
  if (plain) return [Number(plain[1]), Number(plain[2])];

  // Walk the comma-separated constraints; pick the highest >= / > / ~ / ^ floor.
  let best: [number, number] | null = null;
  for (const raw of trimmed.split(',')) {
    const part = raw.trim();
    const m = part.match(/^(>=|>|~=|~|\^)\s*(\d+)\.(\d+)(?:\.\d+)?$/);
    if (!m) continue;
    const op = m[1]!;
    const major = Number(m[2]);
    let minor = Number(m[3]);
    // `>3.10` means "strictly greater" — the minimum supported version is
    // the next minor. (Rare in practice, but we model it conservatively.)
    if (op === '>') minor = minor + 1;
    const cand: [number, number] = [major, minor];
    if (best === null || cand[0] > best[0] || (cand[0] === best[0] && cand[1] > best[1])) {
      best = cand;
    }
  }
  return best;
}

/** Render `(3, 10)` as `"3.10"` and round-trip through the
 *  `SUPPORTED_PYTHON_VERSIONS` enum.
 *
 *  Returns:
 *   - `null` if the tuple is below the oldest supported version
 *     (we don't claim to model EOL'd CPythons).
 *   - the exact match when one exists.
 *   - the HIGHEST supported version when the tuple is newer than anything
 *     we know about. A project that requires e.g. `>=3.14` also supports
 *     everything 3.13 supports, so resolving to `"3.13"` is always correct
 *     for the version-gating use case (we only ever ask "is the project's
 *     floor >= some N?"). Without this clamp the resolver would return
 *     `null` on every new CPython release until our enum is bumped, and
 *     sidecars would silently refuse 3.9-gated transforms on projects
 *     that obviously support them. */
function tupleToVersionString(v: [number, number]): PythonVersionString | null {
  const s = `${v[0]}.${v[1]}`;
  const versions = SUPPORTED_PYTHON_VERSIONS as readonly string[];
  if (versions.includes(s)) return s as PythonVersionString;
  // SUPPORTED_PYTHON_VERSIONS is ordered ascending; last entry is the max.
  const highest = versions[versions.length - 1]!;
  const [hiMaj, hiMin] = highest.split('.').map(Number) as [number, number];
  if (v[0] > hiMaj || (v[0] === hiMaj && v[1] > hiMin)) {
    return highest as PythonVersionString;
  }
  // Below the oldest supported version.
  return null;
}

/** Auto-detect the project's minimum Python version from `pyproject.toml`. We
 *  use a regex sweep rather than a full TOML parser — both PEP 621
 *  (`[project] requires-python = "..."`) and Poetry
 *  (`[tool.poetry.dependencies] python = "..."`) are simple enough to read
 *  this way and it lets us avoid pulling a TOML dep into the runtime bundle.
 *  Returns `null` when no usable spec is found. */
export async function detectPythonVersionFromPyproject(
  projectRoot: string,
): Promise<PythonVersionString | null> {
  let content: string;
  try {
    content = await fs.readFile(path.join(projectRoot, 'pyproject.toml'), 'utf8');
  } catch {
    return null;
  }

  // PEP 621: top-level `requires-python = "..."` under `[project]`.
  const pep621 = content.match(/^\s*requires-python\s*=\s*"([^"]+)"/m);
  if (pep621) {
    const v = parseRequiresPythonMin(pep621[1]!);
    if (v) {
      const s = tupleToVersionString(v);
      if (s) return s;
    }
  }

  // Poetry: `[tool.poetry.dependencies]` → `python = "..."`. We anchor on the
  // `python = "..."` line because the section header parsing is brittle in a
  // regex world, but `python` is a reserved Poetry key.
  const poetry = content.match(/^\s*python\s*=\s*"([^"]+)"/m);
  if (poetry) {
    const v = parseRequiresPythonMin(poetry[1]!);
    if (v) {
      const s = tupleToVersionString(v);
      if (s) return s;
    }
  }

  return null;
}

/** Resolve the effective Python version for this run. Order of precedence:
 *  1. Explicit `pythonVersion` in `.refactronrc` (caller decides).
 *  2. `pyproject.toml` auto-detection.
 *  3. `null` — sidecars treat this as "unknown" and refuse version-gated
 *     transforms (conservative over-skip; over-skip beats under-skip). */
export async function resolvePythonVersion(
  projectRoot: string,
  config: Pick<RefactronRc, 'pythonVersion'>,
): Promise<PythonVersionString | null> {
  if (config.pythonVersion) return config.pythonVersion;
  return detectPythonVersionFromPyproject(projectRoot);
}

export async function loadRefactronConfig(projectRoot: string): Promise<RefactronRc> {
  const explorer = cosmiconfig('refactron', {
    searchPlaces: ['.refactronrc', '.refactronrc.json', '.refactronrc.yaml', 'refactron.config.js'],
    stopDir: projectRoot,
  });
  const result = await explorer.search(projectRoot);
  if (!result) return { ...DEFAULTS, documentation: { ...DOCS_DEFAULT } };
  const data = (result.config ?? {}) as Partial<RefactronRc>;
  if (!validate(data)) {
    const msg = ajv.errorsText(validate.errors, { separator: '; ' });
    throw new Error(`Invalid .refactronrc: ${msg}`);
  }
  return {
    ...DEFAULTS,
    ...data,
    documentation: { ...DOCS_DEFAULT, ...(data.documentation ?? {}) },
  } as RefactronRc;
}
