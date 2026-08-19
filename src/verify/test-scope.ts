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
//
// RULE FOR EDITING THE TABLES BELOW (ADR-12 Compliance). Every flag added to a
// FlagTable arrives with a test row, and a flag placed in `valueLong` or
// `valueShort` arrives with a row of the shape `runner <flag> <value> <path>`
// asserting `narrowed`. That is the only assertion that catches an arity error,
// and an arity error is dangerous in one direction: a flag wrongly filed as
// taking a value SWALLOWS the following positional and yields `full`. Two live
// bugs came from this table being written from memory rather than from `--help`:
// `--cov` (pytest-cov takes an optional value) and vitest `-w` (takes none).
//
// Flags that exit 0 WITHOUT running the suite (`--collect-only`, `--help`) are
// narrowing, not boolean: they select zero tests, still import every test
// module, and coverage then marks module-level changed lines as executed. That
// combination produced a real false SAFE.

import { SHELL_COMPOSITE_RE } from '../analyze/coverage/python-line-coverage.js';

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
    // Collection-only runs are the MAXIMAL narrowing: they select zero tests to
    // execute, exit 0 (so the tests gate passes on exit code alone), and still
    // IMPORT every test module, so coverage.py marks module-level changed lines
    // as executed. Reproduced: a changed module constant read UNSAFE under
    // `python3 -m pytest -q` and SAFE under `python3 -m pytest -q
    // --collect-only`, with coverage 1/1. Any flag that exits 0 while running
    // nothing belongs here, not in boolLong.
    '--collect-only',
    '--co',
    '--help',
    '--version',
    '--fixtures',
    '--markers',
    '--setup-plan',
  ]),
  // `-k` is a name expression, `-m` a marker expression. Both select a subset.
  // Reaching pytest's `-m` requires having already consumed python's own `-m`
  // module flag; see parseRunner.
  narrowingShort: new Set(['-k', '-m', '-h']),
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
    // pytest-cov declares --cov with nargs='?', so `--cov src` consumes `src`
    // as the coverage SOURCE and still runs the whole suite. Filed as boolLong
    // it left `src` to be read as a path filter, which floored one of the most
    // common Python CI commands there is at UNPROVEN.
    '--cov',
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
    // Reordering, not filtering: every test still runs.
    '--failed-first',
    '--ff',
    '--new-first',
    '--nf',
    // Stops at the first FAILURE, so a green run still executed everything.
    '--stepwise',
    '--sw',
  ]),
  // `-h` is deliberately NOT here: it exits 0 without running tests, the same
  // shape as --collect-only, and lives in narrowingLong as --help.
  valueShort: new Set(['-n', '-p', '-W', '-o', '-c', '-r']),
  boolShort: new Set(['-q', '-v', '-x', '-s', '-l']),
  subcommands: new Set(),
};

// Transcribed from `python3 -m unittest --help` on Python 3.13, not from memory.
// The main form takes `[tests ...]` positionals documented as "a list of any
// number of test modules, classes and test methods" - narrowing by definition.
// The `discover` subform adds -s/-p/-t.
const UNITTEST: FlagTable = {
  narrowingLong: new Set([
    // Exits without running anything, same rule as pytest's --collect-only.
    '--help',
  ]),
  // -k is "Only run tests which match the given substring".
  narrowingShort: new Set(['-k', '-h']),
  valueLong: new Set(['--durations', '--start-directory', '--pattern', '--top-level-directory']),
  boolLong: new Set(['--verbose', '--quiet', '--locals', '--failfast', '--catch', '--buffer']),
  // -s is the CANONICAL whole-suite spelling for unittest, unlike `pytest
  // tests/`: bare `discover` starts from `.`, so pointing it at the test
  // directory is how a full unittest run is normally written. Flooring it would
  // put SAFE out of reach for essentially every unittest project.
  //
  // KNOWN UNDER-FLOOR: -p/--pattern with a non-default value does narrow
  // discovery, and we treat it as an ordinary value flag. Detecting "non-default"
  // reliably is not worth a false `narrowed`; recorded in ADR-12.
  valueShort: new Set(['-s', '-p', '-t']),
  boolShort: new Set(['-v', '-q', '-f', '-c', '-b']),
  subcommands: new Set(['discover']),
};

/** A runner we can locate but whose CLI we do not model: `python3 script.py`.
 *  Empty tables on purpose - see the script-form branch in parseRunner. */
const SCRIPT_FORM: FlagTable = {
  narrowingLong: new Set(),
  narrowingShort: new Set(),
  valueLong: new Set(),
  boolLong: new Set(),
  valueShort: new Set(),
  boolShort: new Set(),
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
    // Zero-test-run flags, same rule as pytest's --collect-only.
    '--help',
    '--version',
  ]),
  narrowingShort: new Set(['-t', '-h']),
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
  // `-w` is --watch and takes NO value. Filed under valueShort it swallowed the
  // following token, so `vitest run -w src/foo.test.ts` classified as `full`
  // while vitest ran only that one file. An entry misfiled INTO a value table
  // eats a real positional and yields `full`, which is the dangerous direction.
  valueShort: new Set(['-c', '-r']),
  boolShort: new Set(['-u', '-w']),
  // `run` and `watch` are mode subcommands, not path filters. `list` is NOT
  // here: it collects without executing, the same shape as --collect-only.
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
    // Zero-test-run flags, same rule as pytest's --collect-only.
    '--help',
    '--version',
    '--listTests',
  ]),
  narrowingShort: new Set(['-t', '-o', '-f', '-h']),
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
  boolShort: new Set(['-i', '-u']),
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
  /** Values of leading NAME=VALUE assignments whose variable feeds ARGUMENTS to
   *  the runner. Stripping these unexamined produced a false SAFE:
   *  `PYTEST_ADDOPTS="-k test_scale" python3 -m pytest -q` ran only the matching
   *  tests, and the classifier answered `full` — its strongest claim. The
   *  leading-assignment prefix is the documented, and over MCP the only, way to
   *  pass environment (issues #95 and #98), so it is exactly the form in use. */
  optionEnvValues: string[];
}

/** Environment variables whose value is appended to the runner's own argv, and
 *  can therefore carry a filter. Matched case-sensitively on the assignment
 *  NAME. `PYTHONPATH` is deliberately absent: it changes import resolution, not
 *  test selection, and treating it as an option source would break the #95/#98
 *  remedy this classifier is required to leave alone. */
const OPTION_ENV_NAMES = new Set(['PYTEST_ADDOPTS', 'VITEST_ADDOPTS', 'JEST_ADDOPTS']);

/** Which runner each option-carrying variable actually feeds. The AMBIENT
 *  environment reaches every command, so without this gate a `PYTEST_ADDOPTS`
 *  exported in a shell would floor a vitest project's verdict for a variable its
 *  runner never reads. Inline assignments are already scoped by position; this is
 *  only for values arriving from the surrounding environment. */
const OPTION_ENV_RUNNERS: Record<string, ReadonlySet<string>> = {
  PYTEST_ADDOPTS: new Set(['pytest', 'py.test', 'unittest']),
  VITEST_ADDOPTS: new Set(['vitest']),
  JEST_ADDOPTS: new Set(['jest']),
};

/** Identify the runner and return its arguments, or null when unrecognised. */
function parseRunner(tokens: string[]): ParsedRunner | null {
  let rest = tokens;
  const optionEnvValues: string[] = [];

  // Strip leading NAME=VALUE assignments, KEEPING the value of any variable that
  // feeds arguments to the runner. Stop at the first token that is not an
  // assignment, so a legitimate argument containing `=` is never consumed.
  const takeAssignments = (): void => {
    while (rest.length > 0 && ENV_ASSIGNMENT.test(rest[0] as string)) {
      const tok = rest[0] as string;
      const eq = tok.indexOf('=');
      if (OPTION_ENV_NAMES.has(tok.slice(0, eq))) optionEnvValues.push(tok.slice(eq + 1));
      rest = rest.slice(1);
    }
  };
  takeAssignments();

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
    // `env PYTHONPATH=. pytest ...`. Without this, the whole command read as an
    // unrecognised runner and the filter behind it was never seen.
    if (head === 'env') {
      rest = rest.slice(1);
      takeAssignments();
      continue;
    }
    break;
  }

  // A second pass of NAME=VALUE, because stripping a wrapper can expose more
  // (`env FOO=1 BAR=2 pytest` and `poetry run PYTHONPATH=. pytest`).
  takeAssignments();

  if (rest.length === 0) return null;
  const head = basename(rest[0] as string);

  // `python -m pytest ...`. Consuming the interpreter and its OWN `-m` module
  // flag before scanning is what keeps pytest's `-m` marker flag from being
  // confused with it. Getting this wrong would classify `python3 -m pytest -q`,
  // the single most common Python test command, as narrowed.
  if (/^python[0-9.]*$/.test(head)) {
    if (rest[1] === '-m' && rest.length >= 3) {
      const moduleName = rest[2] as string;
      const table = tableFor(moduleName);
      if (!table) return null;
      return { table, name: moduleName, args: rest.slice(3), optionEnvValues };
    }
    // Script form: `python3 tests/runtests.py [args]`. Django's canonical
    // invocation, and a shape that reached SAFE while narrowed (issue #115).
    //
    // We know nothing about this script's flags, so we cannot know any flag's
    // ARITY. SCRIPT_FORM therefore declares no flags at all: the scanner treats a
    // bare word as a filter and anything starting with `-` as unrecognised, which
    // yields `unknown`. That deliberately UNDER-floors `runtests.py --parallel 4`
    // — the safe direction, since guessing an arity could read a flag's value as a
    // path and steal a deserved SAFE. Recorded as a residual hole in ADR-12.
    if (rest.length >= 2 && /\.py$/.test(rest[1] as string)) {
      return { table: SCRIPT_FORM, name: rest[1] as string, args: rest.slice(2), optionEnvValues };
    }
    return null;
  }

  const table = tableFor(head);
  if (!table) return null;
  return { table, name: head, args: rest.slice(1), optionEnvValues };
}

/** Why a command was unrecognised. `unknown` does not floor the verdict, so
 *  these strings are the only field evidence for whether the carve-out is
 *  drawn in the right place (ADR-12 follow-up). Never throw them away. */
function unknownRunnerSignal(tokens: string[]): string {
  const head = basename(tokens[0] ?? '');
  if (head === '') return 'the command is empty';
  return `${head} is not a recognised test runner, so the scope is unknown`;
}

/** A positional that means "everything from here", which is never narrower than
 *  the runner's own default. `.` and `./` collect from the rootdir; the shadow
 *  root IS the cwd, so this is the whole suite. `tests/` is NOT in this set: a
 *  repo can hold tests outside it, and calling that `full` would be a false
 *  SAFE, the unforgivable direction. */
const WHOLE_TREE_POSITIONALS = new Set(['.', './']);

/** pytest's `-o` / `--override-ini` sets an ini key inline, and two of those
 *  keys select tests: `testpaths` restricts collection, `addopts` injects
 *  arbitrary arguments. The value was previously consumed unexamined, so
 *  `pytest -o testpaths=tests/unit` answered `full` on a narrowed run. */
function isNarrowingIniOverride(flag: string, value: string): boolean {
  if (flag !== '-o' && flag !== '--override-ini') return false;
  const key = value.split('=')[0]?.trim();
  return key === 'testpaths' || key === 'addopts';
}

function tableFor(name: string): FlagTable | null {
  if (name === 'pytest' || name === 'py.test') return PYTEST;
  if (name === 'unittest') return UNITTEST;
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
  // Shell composites are not a command we can reason about: `pytest -q > out`,
  // `pytest a && pytest b`, `cd sub && pytest`. The coverage runner already
  // declines exactly these, and reading a redirection operator as a test path
  // produced `narrowed` with the signal "selects specific paths: >".
  if (SHELL_COMPOSITE_RE.test(command)) {
    return {
      scope: 'unknown',
      signals: ['the command uses shell operators, so its scope is unknown'],
    };
  }

  const tokens = tokenize(command);
  if (tokens.length === 0) return { scope: 'unknown', signals: ['the command is empty'] };

  const parsed = parseRunner(tokens);
  if (!parsed) {
    return { scope: 'unknown', signals: [unknownRunnerSignal(tokens)] };
  }

  const { table, args, optionEnvValues } = parsed;

  // Scan the values of PYTEST_ADDOPTS and friends with the SAME scanner. pytest
  // appends that string to its own argv, so `PYTEST_ADDOPTS="-k test_scale"` is
  // a filter no less than a positional path. Stripping it unexamined answered
  // `full` on a run that executed one test.
  for (const value of optionEnvValues) {
    const inner = scanArgs(table, tokenize(value));
    if (inner.scope !== 'full') {
      return {
        scope: inner.scope,
        signals: inner.signals.map((sig) => `${sig} (from the environment)`),
      };
    }
  }

  return scanArgs(table, args);
}

/** Scan a runner's argv for filters. Shared by the command line and by the
 *  option-carrying environment variables, so the two cannot drift apart. */
function scanArgs(table: FlagTable, args: string[]): { scope: TestScope; signals: string[] } {
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
        const value = eq === -1 ? (args[i + 1] ?? '') : tok.slice(eq + 1);
        if (isNarrowingIniOverride(name, value)) {
          signals.push(`${name} ${value} selects a subset of the suite`);
          return { scope: 'narrowed', signals };
        }
        if (eq === -1) i++; // consume the separate value
        continue;
      }
      if (table.boolLong.has(name)) continue;
      // Unrecognised flag on a RECOGNISED runner. Almost always a plugin flag
      // on a full suite (`pytest --doctest-modules`), which is why `unknown`
      // does not floor: flooring it would turn every plugin flag in the wild
      // into a SAFE-killer fixable only by a PR to us.
      return { scope: 'unknown', signals: [`${name} is not recognised, so the scope is unknown`] };
    }

    if (tok.startsWith('-') && tok.length > 1) {
      const short = tok.slice(0, 2);
      if (table.narrowingShort.has(short)) {
        signals.push(`${short} selects a subset of the suite`);
        return { scope: 'narrowed', signals };
      }
      if (table.valueShort.has(short)) {
        const value = tok.length === 2 ? (args[i + 1] ?? '') : tok.slice(2);
        if (isNarrowingIniOverride(short, value)) {
          signals.push(`${short} ${value} selects a subset of the suite`);
          return { scope: 'narrowed', signals };
        }
        if (tok.length === 2) i++; // `-n 4`; `-n4` carries its own value
        continue;
      }
      // Bundled booleans such as `-qx`.
      const chars = tok.slice(1).split('');
      if (chars.every((c) => table.boolShort.has(`-${c}`))) continue;
      return { scope: 'unknown', signals: [`${short} is not recognised, so the scope is unknown`] };
    }

    // A `#` opens a shell comment, so neither it nor anything after it reaches
    // the runner. Reading `pytest -q #nightly` as a path filter floored a
    // whole-suite command.
    if (tok.startsWith('#')) break;

    // A bare word. Mode subcommands are not filters; anything else is a path or
    // node-id filter.
    if (!seenSubcommand && table.subcommands.has(tok)) {
      seenSubcommand = true;
      continue;
    }
    // An empty token comes from `pytest ""`, which selects nothing and is not a
    // path. Reporting it printed a note ending in a bare colon.
    if (tok.length === 0) continue;
    if (WHOLE_TREE_POSITIONALS.has(tok)) continue;
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
export function assessTestScope(
  override?: string,
  env: Readonly<Record<string, string | undefined>> = {},
  detectedCommand?: string,
): TestScopeAssessment {
  // `detectRunner` guards with `if (opts.override)`, so an empty or
  // whitespace-only string is falsy there and the engine runs its OWN detected,
  // whole-suite command. Reporting `override` for that run would put a false
  // statement in a report the ADR sells as auditable history.
  const hasOverride = override !== undefined && override.trim() !== '';
  const command = hasOverride ? (override as string) : (detectedCommand ?? '');
  const source: 'detected' | 'override' = hasOverride ? 'override' : 'detected';

  // A detected runner with no ambient option variables is whole-suite by
  // construction and needs no parse.
  if (!hasOverride && command === '') {
    const ambient = ambientSignals(env, null);
    return ambient.length > 0
      ? { scope: 'narrowed', source, signals: ambient }
      : { scope: 'full', source, signals: [] };
  }

  const { scope, signals } = classifyTestCommand(command);
  // The ambient environment reaches the runner whatever the command said, so a
  // `full` command can still be narrowed by an exported PYTEST_ADDOPTS. Only
  // consulted when the runner is known: `unknown` already declines to claim
  // anything, and adding an ambient signal to it would not change the verdict.
  if (scope === 'full') {
    const ambient = ambientSignals(env, runnerNameOf(command));
    if (ambient.length > 0) return { scope: 'narrowed', source, signals: ambient };
  }
  return { scope, source, signals };
}

/** Filters arriving from the surrounding environment rather than the command.
 *  `runner` null means we could not resolve one, in which case every
 *  option-carrying variable is considered, since any of them might apply. */
function ambientSignals(
  env: Readonly<Record<string, string | undefined>>,
  runner: string | null,
): string[] {
  const out: string[] = [];
  for (const name of OPTION_ENV_NAMES) {
    const value = env[name];
    if (!value || value.trim() === '') continue;
    if (runner !== null && !OPTION_ENV_RUNNERS[name]?.has(runner)) continue;
    const table = runner !== null ? tableFor(runner) : PYTEST;
    if (!table) continue;
    const inner = scanArgs(table, tokenize(value));
    if (inner.scope === 'narrowed') {
      out.push(`${inner.signals[0] ?? 'a filter'} (from ${name} in the environment)`);
    }
  }
  return out;
}

/** The runner a command resolves to, for gating ambient variables. */
function runnerNameOf(command: string): string | null {
  const parsed = parseRunner(tokenize(command));
  return parsed ? basename(parsed.name).replace(/\.py$/, '') : null;
}
