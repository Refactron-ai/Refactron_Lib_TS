// src/cli/config-loader.ts
// Loads `.refactronrc` configuration via cosmiconfig and validates it against a
// JSON Schema 7 schema with Ajv 8. Flags always override values from disk.
import { cosmiconfig } from 'cosmiconfig';
import Ajv from 'ajv';
import type { ValidateFunction } from 'ajv';

export interface DocumentationConfig {
  provider: 'ollama' | 'openai' | 'anthropic';
  model: string;
  endpoint: string | null;
  tokenBudget: number;
  redactPatterns: string[];
  cache: boolean;
}

export interface RefactronRc {
  transforms: string[]; // 'all' or TransformId values
  exclude: string[];
  testCmd: string | null;
  confidence: 'high' | 'medium' | 'low';
  dryRun: boolean;
  documentation: DocumentationConfig;
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
] as const;

const DOCS_DEFAULT: DocumentationConfig = {
  provider: 'ollama',
  model: 'llama3.1:8b',
  endpoint: 'http://localhost:11434',
  tokenBudget: 4000,
  redactPatterns: [],
  cache: true,
};

const DEFAULTS: RefactronRc = {
  transforms: ['all'],
  exclude: [],
  testCmd: null,
  confidence: 'high',
  dryRun: true,
  documentation: DOCS_DEFAULT,
};

const DOCS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    provider: { type: 'string', enum: ['ollama', 'openai', 'anthropic'] },
    model: { type: 'string' },
    endpoint: { type: ['string', 'null'] },
    tokenBudget: { type: 'integer', minimum: 256, maximum: 32000 },
    redactPatterns: { type: 'array', items: { type: 'string' } },
    cache: { type: 'boolean' },
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
