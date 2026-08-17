// src/verify/test-scope.ts
//
// Classify the test command as `full`, `narrowed` or `unknown`.
//
// Why this exists. `--test-cmd` / `testCmd` is handed straight to a shell
// (src/verify/runners/detect.ts:27) and nothing inspected it. A caller who
// passed `pytest tests/unit/test_foo.py` had hand-scoped the whole verification
// run, and the engine attributed coverage against that subset and returned SAFE.
// Reproduced in issue #110: the same diff against the same repo returns UNSAFE
// under `python3 -m pytest -q` and SAFE under
// `python3 -m pytest -q tests/test_scale.py`, because the one test that pins the
// changed behaviour was not selected. A `narrowed` result floors the verdict at
// UNPROVEN (src/verify/verdict-fuse.ts).
//
// THREE VALUES, NOT TWO. `unknown` is not a soft `full`. A wrapper we cannot
// parse (`make test`, `npm test`, `./run-tests.sh`) is a command whose scope we
// genuinely do not know, and reporting it as `full` would be exactly the
// confident lie this engine exists to avoid. `unknown` does NOT floor the
// verdict — flooring it would make SAFE unreachable for most real projects —
// so it is a disclosed gap, recorded in ADR-12, not a guarantee.
//
// FALSE POSITIVES COST A USER THEIR SAFE. `narrowed` moves a verdict, so every
// unrecognised token degrades to `unknown` rather than guessing. Two negative
// tables in tests/unit/verify/test-scope.test.ts exist for defects this would
// otherwise re-introduce:
//   * The `PYTHONPATH=. python3 -m pytest -q` form from issues #95 and #98 is
//     the DOCUMENTED remedy for shadow bypass. The `.` / `src` / `./src` inside
//     a leading NAME=VALUE assignment must never read as a positional path.
//   * `-n` is xdist worker count, not a filter. `-x` and `--maxfail` only stop
//     early ON FAILURE, and a run that stopped early is red, so it cannot reach
//     SAFE regardless.

export type TestScope = 'full' | 'narrowed' | 'unknown';

export interface TestScopeAssessment {
  scope: TestScope;
  /** `detected` means the engine chose the runner itself, which is whole-suite
   *  by construction; `override` means the caller supplied the command. */
  source: 'detected' | 'override';
  /** Human-readable reasons the scope was judged `narrowed`. Empty otherwise. */
  signals: string[];
}

/** A leading `NAME=VALUE` assignment. Consumed into the environment by the
 *  shell, so it is never a runner or a path filter. */
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** Wrappers that delegate to a real runner. Stripping them lets narrowing
 *  behind `poetry run pytest tests/x.py` still be seen. */
const RUN_WRAPPERS = new Set(['poetry', 'uv', 'pipenv', 'pdm', 'hatch', 'rye']);

interface FlagTable {
  /** Long flags that select a subset. Matched on the name before any `=`. */
  narrowingLong: Set<string>;
  /** Short flags that select a subset. */
  narrowingShort: Set<string>;
  /** Long flags taking a separate value token when not written as `--f=v`. */
  valueLong: Set<string>;
  /** Long flags taking no value. */
  boolLong: Set<string>;
  /** Short flags taking a value, attached (`-n4`) or separate (`-n 4`). */
  valueShort: Set<string>;
  /** Short flags taking no value; may be bundled (`-qx`). */
  boolShort: Set<string>;
  /** Leading positional words that are subcommands, not filters. */
  subcommands: Set<string>;
}

const PYTEST: FlagTable = {
  narrowingLong: new Set([
    '--last-failed',
    '--lf',
    '--ignore',
    '--ignore-glob',
    '--deselect',
    '--last-failed-no-failures',
  ]),
  // `-k` is a name expression, `-m` a marker expression. Both select a subset.
  // Reaching pytest's `-m` requires having already consumed python's own `-m`
  // module flag; see parseRunner.
  narrowingShort: new Set(['-k', '-m']),
  valueLong: new Set([
    '--maxfail',
    '--tb',
    '--color',
    '--durations',
    '--junitxml',
    '--junit-xml',
    '--rootdir',
    '--numprocesses',
    '--dist',
    '--import-mode',
    '--capture',
    '--cov-report',
    '--cov-config',
    '--log-level',
    '--basetemp',
    '--override-ini',
    '--assert',
    '--timeout',
  ]),
  boolLong: new Set([
    '--quiet',
    '--verbose',
    '--exitfirst',
    '--no-header',
    '--no-summary',
    '--strict-markers',
    '--strict-config',
    '--disable-warnings',
    '--showlocals',
    '--full-trace',
    '--cov',
    '--co',
    '--collect-only',
    '--tb-native',
    '--force-sugar',
    // Reordering, not filtering: every test still runs.
    '--failed-first',
    '--ff',
    '--new-first',
    '--nf',
    // Stops at the first FAILURE, so a green run still executed everything.
    '--stepwise',
    '--sw',
  ]),
  valueShort: new Set(['-n', '-p', '-W', '-o', '-c', '-r', '-D']),
  boolShort: new Set(['-q', '-v', '-x', '-s', '-l', '-h']),
  subcommands: new Set(),
};

const VITEST: FlagTable = {
  narrowingLong: new Set([
    '--testNamePattern',
    '--changed',
    '--related',
    '--shard',
    '--project',
    '--dir',
  ]),
  narrowingShort: new Set(['-t']),
  valueLong: new Set([
    '--reporter',
    '--config',
    '--maxWorkers',
    '--minWorkers',
    '--pool',
    '--environment',
    '--outputFile',
    '--bail',
    '--retry',
    '--testTimeout',
    '--coverage.reporter',
  ]),
  boolLong: new Set([
    '--run',
    '--watch',
    '--no-watch',
    '--coverage',
    '--silent',
    '--globals',
    '--passWithNoTests',
    '--threads',
    '--no-threads',
    '--isolate',
    '--no-isolate',
    '--no-color',
    '--allowOnly',
    '--sequence.shuffle',
  ]),
  valueShort: new Set(['-c', '-w', '-r']),
  boolShort: new Set(['-u', '-h']),
  // `vitest run` and `vitest watch` are mode subcommands, not path filters.
  subcommands: new Set(['run', 'watch']),
};

const JEST: FlagTable = {
  narrowingLong: new Set([
    '--testNamePattern',
    '--testPathPattern',
    '--testPathPatterns',
    '--testPathIgnorePatterns',
    '--testMatch',
    '--onlyChanged',
    '--onlyFailures',
    '--findRelatedTests',
    '--changedSince',
    '--lastCommit',
    '--shard',
    '--selectProjects',
    '--runTestsByPath',
  ]),
  narrowingShort: new Set(['-t', '-o', '-f']),
  valueLong: new Set([
    '--maxWorkers',
    '--config',
    '--reporters',
    '--bail',
    '--testTimeout',
    '--coverageDirectory',
    '--maxConcurrency',
    '--outputFile',
  ]),
  boolLong: new Set([
    '--ci',
    '--coverage',
    '--silent',
    '--verbose',
    '--runInBand',
    '--forceExit',
    '--detectOpenHandles',
    '--colors',
    '--no-colors',
    '--no-cache',
    '--passWithNoTests',
    '--watchAll',
    '--noStackTrace',
    '--json',
  ]),
  valueShort: new Set(['-w', '-c']),
  boolShort: new Set(['-i', '-u', '-h']),
  subcommands: new Set(),
};

/** Split a command into tokens, honouring single and double quotes so a quoted
 *  flag value is never mistaken for a positional path filter. */
export function tokenize(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let started = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i] as string;
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\n') {
      if (started || current.length > 0) tokens.push(current);
      current = '';
      started = false;
      continue;
    }
    current += ch;
  }
  if (started || current.length > 0) tokens.push(current);
  return tokens;
}

function basename(p: string): string {
  const parts = p.split('/');
  return parts[parts.length - 1] ?? p;
}

interface ParsedRunner {
  table: FlagTable;
  name: string;
  args: string[];
}

/** Identify the runner and return its arguments, or null when unrecognised. */
function parseRunner(tokens: string[]): ParsedRunner | null {
  let rest = tokens;

  // Strip leading NAME=VALUE assignments. Stop at the first token that is not
  // one, so a legitimate argument containing `=` is never consumed.
  while (rest.length > 0 && ENV_ASSIGNMENT.test(rest[0] as string)) rest = rest.slice(1);

  // Strip wrappers. Bounded so a pathological command cannot spin.
  for (let guard = 0; guard < 8 && rest.length > 0; guard++) {
    const head = basename(rest[0] as string);
    if (head === 'npx' || head === 'bunx') {
      rest = rest.slice(1);
      // npx/bunx flags: -y/--yes are boolean, -p/--package take a value.
      while (rest.length > 0) {
        const t = rest[0] as string;
        if (t === '-y' || t === '--yes') rest = rest.slice(1);
        else if (t === '-p' || t === '--package') rest = rest.slice(2);
        else if (t.startsWith('--package=')) rest = rest.slice(1);
        else break;
      }
      continue;
    }
    if (head === 'pnpm' || head === 'yarn' || head === 'bun') {
      rest = rest.slice(1);
      const next = rest[0];
      if (next === 'exec' || next === 'dlx' || next === 'run' || next === 'x') rest = rest.slice(1);
      while (rest.length > 0 && (rest[0] as string).startsWith('--package')) {
        const t = rest[0] as string;
        rest = t.includes('=') ? rest.slice(1) : rest.slice(2);
      }
      continue;
    }
    if (RUN_WRAPPERS.has(head)) {
      // Only the `run` form delegates to an arbitrary command. `poetry install`
      // is not a test run at all, so anything else is unknown.
      if (rest[1] !== 'run') return null;
      rest = rest.slice(2);
      continue;
    }
    break;
  }

  if (rest.length === 0) return null;
  const head = basename(rest[0] as string);

  // `python -m pytest ...`. Consuming the interpreter and its OWN `-m` module
  // flag before scanning is what keeps pytest's `-m` marker flag from being
  // confused with it. Getting this wrong would classify `python3 -m pytest -q`,
  // the single most common Python test command, as narrowed.
  if (/^python[0-9.]*$/.test(head)) {
    if (rest[1] !== '-m' || rest.length < 3) return null; // running a script: unknown
    const moduleName = rest[2] as string;
    const table = tableFor(moduleName);
    if (!table) return null;
    return { table, name: moduleName, args: rest.slice(3) };
  }

  const table = tableFor(head);
  if (!table) return null;
  return { table, name: head, args: rest.slice(1) };
}

function tableFor(name: string): FlagTable | null {
  if (name === 'pytest' || name === 'py.test') return PYTEST;
  if (name === 'vitest') return VITEST;
  if (name === 'jest') return JEST;
  return null;
}

/**
 * Classify a test command string.
 *
 * Returns `narrowed` only when a filter is positively identified. Anything not
 * recognised returns `unknown`, never `full`.
 */
export function classifyTestCommand(command: string): { scope: TestScope; signals: string[] } {
  const tokens = tokenize(command);
  if (tokens.length === 0) return { scope: 'unknown', signals: [] };

  const parsed = parseRunner(tokens);
  if (!parsed) return { scope: 'unknown', signals: [] };

  const { table, args } = parsed;
  const signals: string[] = [];
  let seenSubcommand = false;

  for (let i = 0; i < args.length; i++) {
    const tok = args[i] as string;

    // Everything after `--` is positional by definition.
    if (tok === '--') {
      const positionals = args.slice(i + 1).filter((t) => t.length > 0);
      if (positionals.length > 0) {
        signals.push(`selects specific paths: ${positionals.join(' ')}`);
        return { scope: 'narrowed', signals };
      }
      break;
    }

    if (tok.startsWith('--')) {
      const eq = tok.indexOf('=');
      const name = eq === -1 ? tok : tok.slice(0, eq);
      if (table.narrowingLong.has(name)) {
        signals.push(`${name} selects a subset of the suite`);
        return { scope: 'narrowed', signals };
      }
      if (table.valueLong.has(name)) {
        if (eq === -1) i++; // consume the separate value
        continue;
      }
      if (table.boolLong.has(name)) continue;
      return { scope: 'unknown', signals: [] }; // unrecognised flag
    }

    if (tok.startsWith('-') && tok.length > 1) {
      const short = tok.slice(0, 2);
      if (table.narrowingShort.has(short)) {
        signals.push(`${short} selects a subset of the suite`);
        return { scope: 'narrowed', signals };
      }
      if (table.valueShort.has(short)) {
        if (tok.length === 2) i++; // `-n 4`; `-n4` carries its own value
        continue;
      }
      // Bundled booleans such as `-qx`.
      const chars = tok.slice(1).split('');
      if (chars.every((c) => table.boolShort.has(`-${c}`))) continue;
      return { scope: 'unknown', signals: [] };
    }

    // A bare word. Mode subcommands are not filters; anything else is a path or
    // node-id filter.
    if (!seenSubcommand && table.subcommands.has(tok)) {
      seenSubcommand = true;
      continue;
    }
    signals.push(`selects specific paths: ${tok}`);
    return { scope: 'narrowed', signals };
  }

  return { scope: 'full', signals: [] };
}

/**
 * Assess the scope of the run.
 *
 * With no override the engine detects the runner itself, and every detected
 * form in src/verify/runners/detect.ts is whole-suite by construction: no path
 * arguments, no `-k`, no filters. That path is `full` without inspection.
 */
export function assessTestScope(override?: string): TestScopeAssessment {
  if (override === undefined) return { scope: 'full', source: 'detected', signals: [] };
  const { scope, signals } = classifyTestCommand(override);
  return { scope, source: 'override', signals };
}
