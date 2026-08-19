// tests/unit/verify/test-scope.test.ts
//
// The classifier behind issue #110. A `narrowed` classification floors the
// verdict at UNPROVEN, so a FALSE POSITIVE here costs a user their SAFE on a
// legitimate command. The negative tables below are therefore not decoration:
// they pin the exact forms that issues #95 and #98 established as the
// documented remedy for shadow bypass, and the parallelism flags that appear in
// ordinary CI commands.
import { describe, it, expect } from 'vitest';
import { classifyTestCommand, assessTestScope } from '../../../src/verify/test-scope.js';

function scopeOf(cmd: string): string {
  return classifyTestCommand(cmd).scope;
}

describe('classifyTestCommand', () => {
  describe('narrowed: the command names a subset of the suite', () => {
    const NARROWED = [
      'pytest tests/unit/test_foo.py',
      'pytest tests/unit',
      'pytest tests/test_a.py::test_b',
      'pytest -k parser',
      'pytest -m slow',
      'pytest --last-failed',
      'pytest --ignore=tests/slow',
      'npx vitest run src/foo',
      'npx vitest run -t "parses"',
      'npx jest --testPathPattern=foo',
      'npx jest -t "parses"',
      'npx jest --onlyChanged',
    ];
    for (const cmd of NARROWED) {
      it(`narrowed: ${cmd}`, () => {
        expect(scopeOf(cmd)).toBe('narrowed');
      });
    }

    it('reports the signal it matched, so the CLI can name it', () => {
      const a = classifyTestCommand('pytest -k parser');
      expect(a.scope).toBe('narrowed');
      expect(a.signals.length).toBeGreaterThan(0);
      expect(a.signals.join(' ')).toContain('-k');
    });

    it('names a positional path filter distinctly from a flag', () => {
      const a = classifyTestCommand('pytest tests/unit/test_foo.py');
      expect(a.signals.join(' ')).toContain('tests/unit/test_foo.py');
    });
  });

  describe('full: the command names no filter', () => {
    const FULL = ['python3 -m pytest -q', 'pytest -q', 'npx vitest run', 'npx jest'];
    for (const cmd of FULL) {
      it(`full: ${cmd}`, () => {
        expect(scopeOf(cmd)).toBe('full');
      });
    }
  });

  describe('unknown: an unrecognised wrapper is not a claim of fullness', () => {
    const UNKNOWN = ['make test', 'npm test', './scripts/test.sh'];
    for (const cmd of UNKNOWN) {
      it(`unknown: ${cmd}`, () => {
        expect(scopeOf(cmd)).toBe('unknown');
      });
    }

    it('an unrecognised flag yields unknown, never a confident full', () => {
      // Reporting "full" for a command we did not fully parse is the confident
      // lie this project keeps having to un-ship.
      expect(scopeOf('pytest --some-plugin-flag')).toBe('unknown');
    });
  });

  // AC-3. These are the forms docs/verification/verdicts.mdx tells users to
  // adopt when the shadow tree is bypassed by an editable install. A classifier
  // that reads the `.`, `src` or `./src` inside a leading NAME=VALUE assignment
  // as a positional path filter would floor every one of them at UNPROVEN and
  // break the documented fix for a different correctness bug.
  describe('AC-3 negative: the #95 / #98 PYTHONPATH remedy stays full', () => {
    const LEGITIMATE = [
      'PYTHONPATH=. python3 -m pytest -q',
      'PYTHONPATH=src python3 -m pytest -q',
      'PYTHONPATH=./src python3 -m pytest -q',
      'COVERAGE_CORE=sysmon python3 -m pytest -q',
      'PYTHONPATH=. pytest -q',
    ];
    for (const cmd of LEGITIMATE) {
      it(`protects #95/#98: ${cmd}`, () => {
        expect(scopeOf(cmd)).toBe('full');
      });
    }

    it('a leading assignment does not hide a real filter behind it', () => {
      expect(scopeOf('PYTHONPATH=. python3 -m pytest -q tests/test_a.py')).toBe('narrowed');
    });
  });

  // AC-4. `-n` is xdist worker count, not a filter. `-x` and `--maxfail` only
  // stop early ON FAILURE, and a run that stopped early is red, so it cannot
  // reach SAFE anyway. Treating any of these as narrowing would break ordinary
  // CI commands for no integrity gain.
  describe('AC-4 negative: parallelism and fail-fast are not narrowing', () => {
    const FULL = [
      'pytest -n auto',
      'pytest -n 4',
      'pytest -n4',
      'pytest -x',
      'pytest --maxfail=1',
      'pytest -q -x -n auto',
      'python3 -m pytest -q --maxfail 1',
    ];
    for (const cmd of FULL) {
      it(`not narrowing: ${cmd}`, () => {
        expect(scopeOf(cmd)).toBe('full');
      });
    }
  });

  describe('python -m parsing', () => {
    it("does not read python's own -m module flag as pytest's -m marker flag", () => {
      // `python3 -m pytest` and `pytest -m slow` both contain "-m". Confusing
      // them would classify the single most common Python test command as
      // narrowed and floor every Python project at UNPROVEN.
      expect(scopeOf('python3 -m pytest -q')).toBe('full');
      expect(scopeOf('pytest -m slow')).toBe('narrowed');
      expect(scopeOf('python -m pytest -m slow')).toBe('narrowed');
    });

    it('running a script directly with no arguments is full (changed by #115)', () => {
      // This asserted `unknown` before #115, when parseRunner rejected the script
      // form outright. It is now recognised: a script invoked with no arguments
      // NAMES no filter, and that is exactly what `full` means here — the docs say
      // `full` is a claim about the command, not a promise the run was the whole
      // suite. Arguments after the script are a filter (see the script-form
      // table), and any flag stays `unknown` because we cannot know its arity.
      expect(scopeOf('python3 run_tests.py')).toBe('full');
      expect(scopeOf('python3 run_tests.py unit')).toBe('narrowed');
      expect(scopeOf('python3 run_tests.py --only unit')).toBe('unknown');
    });
  });

  describe('wrapper prefixes are stripped before classification', () => {
    it('strips npx and its flags', () => {
      expect(scopeOf('npx -y vitest run')).toBe('full');
      expect(scopeOf('npx -y -p vitest vitest run src/foo')).toBe('narrowed');
    });

    it('strips runner wrappers so narrowing behind them is still seen', () => {
      expect(scopeOf('poetry run pytest -q')).toBe('full');
      expect(scopeOf('poetry run pytest tests/test_a.py')).toBe('narrowed');
      expect(scopeOf('uv run pytest -q')).toBe('full');
    });
  });

  // A flag that exits 0 without running the suite is the MAXIMAL narrowing, and
  // it is the one shape that reached a real false SAFE on this branch:
  // --collect-only selects zero tests, exits 0 so the tests gate passes, and
  // still imports every test module so coverage marks module-level changed lines
  // executed. Verdict went SAFE on a diff the full suite called UNSAFE.
  describe('flags that exit 0 without running the suite are narrowing', () => {
    const ZERO_TEST_RUNS = [
      'python3 -m pytest -q --collect-only',
      'pytest --collect-only',
      'pytest --co',
      'pytest --help',
      'pytest -h',
      'pytest --version',
      'pytest --fixtures',
      'pytest --markers',
    ];
    for (const cmd of ZERO_TEST_RUNS) {
      it(`narrowed: ${cmd}`, () => {
        expect(scopeOf(cmd)).toBe('narrowed');
      });
    }
  });

  // ARITY PROOF. A flag wrongly filed as taking a value SWALLOWS the following
  // token, so a real path filter goes unread and the command classifies `full`
  // — the dangerous direction. Only a row of the shape
  // `runner <flag> <value> <path>` catches that, so every value-taking flag gets
  // one. Two live bugs came from writing these tables from memory: pytest
  // `--cov` (takes an OPTIONAL value) and vitest `-w` (takes NONE).
  describe('value-flag arity: a trailing path is still seen', () => {
    const ROWS: Array<[string, string]> = [
      ['pytest -n 4 tests/test_a.py', 'narrowed'],
      ['pytest -p no:cacheprovider tests/test_a.py', 'narrowed'],
      ['pytest -o addopts= tests/test_a.py', 'narrowed'],
      ['pytest --maxfail 1 tests/test_a.py', 'narrowed'],
      ['pytest --tb short tests/test_a.py', 'narrowed'],
      ['pytest --cov src tests/test_a.py', 'narrowed'],
      ['npx vitest run --reporter verbose src/foo', 'narrowed'],
      ['npx jest --maxWorkers 2 foo', 'narrowed'],
    ];
    for (const [cmd, want] of ROWS) {
      it(`${want}: ${cmd}`, () => {
        expect(scopeOf(cmd)).toBe(want);
      });
    }

    it('pytest --cov takes an optional value, so `--cov src` is a full run', () => {
      // pytest-cov declares --cov with nargs='?'. Reading `src` as a path filter
      // floored one of the most common Python CI commands there is.
      expect(scopeOf('pytest --cov src')).toBe('full');
      expect(scopeOf('pytest --cov=src')).toBe('full');
      expect(scopeOf('pytest --cov')).toBe('full');
    });

    it('vitest -w is --watch and takes no value, so the next token is a filter', () => {
      expect(scopeOf('npx vitest run -w src/foo.test.ts')).toBe('narrowed');
    });
  });

  // Shell operators are not paths. The coverage runner already declines these
  // via the same regex, so the two parsers cannot disagree about what the shell
  // would do. Previously `pytest -q > out.txt` reported
  // `narrowed: selects specific paths: >`, which is both wrong and unactionable.
  describe('shell composites are unknown, not narrowed', () => {
    const COMPOSITES = [
      'pytest -q > out.txt',
      'pytest -q 2>&1 | tee log',
      'pytest -q || true',
      'python3 -m pytest -q && echo ok',
      'python3 -m pytest -q; echo ok',
      'cd sub && pytest -q',
      'pytest $(cat args.txt)',
    ];
    for (const cmd of COMPOSITES) {
      it(`unknown: ${cmd}`, () => {
        expect(scopeOf(cmd)).toBe('unknown');
      });
    }
  });

  // A false `narrowed` costs a user their SAFE, so a positional that means
  // "everything from here" must not trip the filter check. `.` collects from the
  // rootdir, which is the shadow root, so it is never narrower than the default.
  // `tests/` is deliberately NOT in this set: a repo can hold tests outside it,
  // and calling that full would be a false SAFE.
  describe('whole-tree positionals are not narrowing', () => {
    it('pytest . and pytest ./ are full', () => {
      expect(scopeOf('pytest .')).toBe('full');
      expect(scopeOf('pytest ./')).toBe('full');
      expect(scopeOf('python3 -m pytest -q .')).toBe('full');
    });

    it('but a directory IS narrowing, deliberately', () => {
      // Documented in docs/verification/verdicts.mdx: even `pytest tests/`
      // counts as narrowed, because tests can live outside that directory.
      expect(scopeOf('pytest tests/')).toBe('narrowed');
      expect(scopeOf('pytest tests')).toBe('narrowed');
    });
  });

  describe('unknown carries a reason, so the ADR-12 carve-out can be measured', () => {
    it('names the unrecognised runner', () => {
      const a = classifyTestCommand('make test');
      expect(a.scope).toBe('unknown');
      expect(a.signals.join(' ')).toContain('make');
    });

    it('names the unrecognised flag', () => {
      const a = classifyTestCommand('pytest --doctest-modules');
      expect(a.scope).toBe('unknown');
      expect(a.signals.join(' ')).toContain('--doctest-modules');
    });

    it('says so for a shell composite', () => {
      expect(classifyTestCommand('pytest -q && echo ok').signals.join(' ')).toContain(
        'shell operators',
      );
    });
  });

  describe('env prefix is stripped like an assignment run', () => {
    it('sees the runner and any filter behind `env`', () => {
      expect(scopeOf('env PYTHONPATH=. pytest -q')).toBe('full');
      expect(scopeOf('env PYTHONPATH=. pytest tests/test_a.py')).toBe('narrowed');
    });
  });

  // A leading assignment is normally inert, which is the whole point of the
  // #95/#98 protection above. But PYTEST_ADDOPTS is APPENDED TO PYTEST'S ARGV,
  // so its value is a filter like any other. Stripping it unexamined answered
  // `full` on a run that executed a single test: a false SAFE reached through
  // the one form issues #95/#98 tell users to adopt, and the only in-band way to
  // pass environment over MCP.
  describe('assignments whose value carries arguments are scanned, not discarded', () => {
    it('PYTEST_ADDOPTS carrying a filter is narrowing', () => {
      const a = classifyTestCommand('PYTEST_ADDOPTS="-k test_scale" python3 -m pytest -q');
      expect(a.scope).toBe('narrowed');
      expect(a.signals.join(' ')).toContain('from the environment');
    });

    it('sees it behind an env prefix too', () => {
      expect(scopeOf('env PYTEST_ADDOPTS="-k x" pytest -q')).toBe('narrowed');
    });

    it('does NOT fire when the value carries no filter', () => {
      expect(scopeOf('PYTEST_ADDOPTS="-q --strict-markers" python3 -m pytest -q')).toBe('full');
    });

    it('leaves PYTHONPATH alone: it changes imports, not selection', () => {
      // Regression guard for #95/#98. If PYTHONPATH were ever treated as an
      // option source, the documented shadow-bypass remedy would floor.
      expect(scopeOf('PYTHONPATH=. python3 -m pytest -q')).toBe('full');
      expect(scopeOf('PYTHONPATH=./src python3 -m pytest -q')).toBe('full');
    });
  });

  // pytest's `-o` / `--override-ini` sets an ini key inline, and two of those
  // keys select tests. The value was being consumed unexamined.
  describe('ini overrides that select tests are narrowing', () => {
    const ROWS: Array<[string, string]> = [
      ['pytest -o testpaths=tests/unit', 'narrowed'],
      ['pytest --override-ini=testpaths=tests/unit', 'narrowed'],
      ['pytest -o addopts=-k x', 'narrowed'],
      ['pytest -o cache_dir=/tmp/x', 'full'],
      ['pytest --override-ini=log_cli=true', 'full'],
    ];
    for (const [cmd, want] of ROWS) {
      it(`${want}: ${cmd}`, () => {
        expect(scopeOf(cmd)).toBe(want);
      });
    }
  });

  // One rule, three runners. The zero-test-run rule was originally applied to
  // pytest only, so `npx jest -h` still answered `full`.
  describe('the zero-test-run rule applies to every runner', () => {
    const ROWS = [
      'npx jest -h',
      'npx jest --help',
      'npx jest --version',
      'npx jest --listTests',
      'npx vitest run --help',
      'npx vitest run --version',
    ];
    for (const cmd of ROWS) {
      it(`narrowed: ${cmd}`, () => {
        expect(scopeOf(cmd)).toBe('narrowed');
      });
    }
  });

  // Costly direction: these are whole-suite commands that were being floored.
  describe('tokens the shell never passes to the runner are not filters', () => {
    it('a # comment is not a path', () => {
      expect(scopeOf('pytest -q #nightly')).toBe('full');
      expect(scopeOf('python3 -m pytest -q  # run everything')).toBe('full');
    });

    it('an empty quoted token is not a path', () => {
      expect(scopeOf('pytest ""')).toBe('full');
    });
  });

  describe('every unknown carries a reason', () => {
    it('including an unrecognised SHORT flag', () => {
      const a = classifyTestCommand('pytest -Z');
      expect(a.scope).toBe('unknown');
      expect(a.signals.join(' ')).toContain('-Z');
    });
  });

  // AC-4, extended. These entries were filed as reordering-or-diagnostic rather
  // than filtering, and had no rows at all; `--ff` sits one character from
  // `--lf`, which IS narrowing, so a future reader is likely to "correct" them.
  describe('AC-4 extended: reordering and diagnostics are not narrowing', () => {
    const FULL = [
      'pytest --stepwise',
      'pytest --sw',
      'pytest --failed-first',
      'pytest --ff',
      'pytest --new-first',
      'pytest --nf',
      'pytest --exitfirst',
      'pytest -n auto --dist loadscope',
      'pytest -p xdist -n auto',
      'PYTHONPATH=.:src python3 -m pytest -q',
      'PYTHONPATH=. python3 -m pytest -q --cov=src --cov-report=term',
      'env PYTHONPATH=src python3 -m pytest -q',
      'poetry run PYTHONPATH=. pytest -q',
      'npx vitest run --maxWorkers 4 --bail 1',
      'npx jest --maxWorkers=2 --ci',
    ];
    for (const cmd of FULL) {
      it(`full: ${cmd}`, () => {
        expect(scopeOf(cmd)).toBe('full');
      });
    }
  });

  // The arity rule the file header states is only actually exercised by the
  // ATTACHED form: with `-n 4 path` a mutation making the consume unconditional
  // still passes, because the separated value hides it.
  describe('attached short-flag values do not swallow the next token', () => {
    const ROWS = ['pytest -n4 tests/test_a.py', 'pytest -pno:cacheprovider tests/test_a.py'];
    for (const cmd of ROWS) {
      it(`narrowed: ${cmd}`, () => {
        expect(scopeOf(cmd)).toBe('narrowed');
      });
    }
  });

  // Issue #115. An unrecognised runner carrying arguments narrows and still
  // reached SAFE. Reproduced on main: `python3 -m unittest tests.test_scale`
  // returned SAFE on a diff that `python3 -m unittest discover -s tests` called
  // UNSAFE.
  //
  // Built as two RECOGNITIONS rather than one heuristic. "Floor any unrecognised
  // runner with a positional argument" is undecidable: for an unrecognised runner
  // you do not know any flag's arity, so you cannot tell a positional from a
  // flag's value — and `unittest discover -s tests` proves it, where `discover`
  // is a bare word and `tests` is -s's value. Reading that as a filter would
  // floor a whole suite and steal a deserved SAFE.
  //
  // Table taken from `python3 -m unittest --help` on 3.13, not from memory.
  describe('unittest is a recognised runner (#115)', () => {
    const ROWS: Array<[string, string]> = [
      // Positionals are test modules, classes or methods: narrowing.
      ['python3 -m unittest tests.test_scale', 'narrowed'],
      ['python3 -m unittest module.TestClass', 'narrowed'],
      ['python3 -m unittest module.Class.test_method', 'narrowed'],
      ['python -m unittest tests/test_file.py', 'narrowed'],
      // -k is documented as "Only run tests which match the given substring".
      ['python3 -m unittest -k parser', 'narrowed'],
      ['python3 -m unittest discover -k parser', 'narrowed'],
      // Zero-test runs, same rule as pytest's --collect-only.
      ['python3 -m unittest -h', 'narrowed'],
      ['python3 -m unittest --help', 'narrowed'],
      // `discover` is a SUBCOMMAND, not a filter.
      ['python3 -m unittest discover', 'full'],
      // -s/-t/-p take values. `-s tests` is the CANONICAL whole-suite form for
      // unittest, unlike `pytest tests/`: bare `discover` starts from `.`, so
      // pointing it at the test directory is how a full unittest run is spelled.
      ['python3 -m unittest discover -s tests', 'full'],
      ['python3 -m unittest discover -s tests -t .', 'full'],
      ['python3 -m unittest discover --start-directory tests', 'full'],
      // Ordinary boolean flags.
      ['python3 -m unittest discover -v', 'full'],
      ['python3 -m unittest -q --locals', 'full'],
      ['python3 -m unittest -f -c -b', 'full'],
      ['python3 -m unittest --durations 5', 'full'],
      // Arity proof: a value flag must not swallow a following positional.
      ['python3 -m unittest discover -s tests tests.test_scale', 'narrowed'],
      ['python3 -m unittest --durations 5 tests.test_scale', 'narrowed'],
      // An unrecognised flag stays unknown, never a confident full.
      ['python3 -m unittest --some-future-flag', 'unknown'],
    ];
    for (const [cmd, want] of ROWS) {
      it(`${want}: ${cmd}`, () => {
        expect(scopeOf(cmd)).toBe(want);
      });
    }
  });

  // The second recognition: `python3 path/to/script.py <args>`, which
  // parseRunner rejected outright. Django's `runtests.py auth` is the shape that
  // matters. Rule: no args -> full; a bare positional -> narrowed; ANY flag ->
  // unknown, because we do not know that flag's arity and guessing could steal a
  // SAFE. That last row deliberately UNDER-floors, which is the safe direction.
  describe('script-form runners (#115)', () => {
    const ROWS: Array<[string, string]> = [
      ['python3 tests/runtests.py auth', 'narrowed'],
      ['python3 tests/runtests.py auth sessions', 'narrowed'],
      ['python3 runtests.py', 'full'],
      ['python3 tests/runtests.py', 'full'],
      ['python3 tests/runtests.py --parallel 4', 'unknown'],
      ['python3 tests/runtests.py --verbosity=2', 'unknown'],
      ['PYTHONPATH=. python3 tests/runtests.py auth', 'narrowed'],
    ];
    for (const [cmd, want] of ROWS) {
      it(`${want}: ${cmd}`, () => {
        expect(scopeOf(cmd)).toBe(want);
      });
    }
  });

  // The carve-out ADR-12 bought with the `unknown` policy must survive: a
  // RECOGNISED runner carrying an unrecognised flag is a full suite in fact, and
  // flooring it would turn every plugin flag in the wild into a SAFE-killer.
  describe('#115 must not touch the ADR-12 unknown carve-out', () => {
    const UNKNOWN_UNFLOORED = [
      'pytest --doctest-modules',
      'pytest -q --forked',
      'make test',
      'npm test',
      'tox',
      './run-tests.sh',
    ];
    for (const cmd of UNKNOWN_UNFLOORED) {
      it(`still unknown: ${cmd}`, () => {
        expect(scopeOf(cmd)).toBe('unknown');
      });
    }
  });

  describe('edge cases', () => {
    it('an empty command is unknown', () => {
      expect(scopeOf('')).toBe('unknown');
      expect(scopeOf('   ')).toBe('unknown');
    });

    it('quoted values are not read as positionals', () => {
      // The two rows below return `narrowed` on the FLAG, before the quoted
      // token is examined, so they do not actually test quoting. The third does:
      // break quote handling and `my report.json` splits into two bare words,
      // the second of which reads as a path filter.
      expect(scopeOf('npx jest --testNamePattern "adds two numbers"')).toBe('narrowed');
      expect(scopeOf('pytest -k "parser and not slow"')).toBe('narrowed');
      expect(scopeOf('npx jest --outputFile "my report.json"')).toBe('full');
    });

    it('vitest run subcommand is not a positional filter', () => {
      expect(scopeOf('npx vitest run --coverage')).toBe('full');
    });
  });
});

// AC-5. With no override the engine picks the runner itself, and every detected
// runner is whole-suite by construction (src/verify/runners/detect.ts).
describe('assessTestScope', () => {
  it('reports full/detected when there is no override', () => {
    const a = assessTestScope(undefined);
    expect(a).toEqual({ scope: 'full', source: 'detected', signals: [] });
  });

  it('treats an empty or blank override as no override, matching detectRunner', () => {
    // `detectRunner` guards with `if (opts.override)`, so a falsy string means
    // the engine runs its own detected command. Calling that `override` would
    // put a false statement in a stored report.
    expect(assessTestScope('')).toEqual({ scope: 'full', source: 'detected', signals: [] });
    expect(assessTestScope('   ')).toEqual({ scope: 'full', source: 'detected', signals: [] });
  });

  // AC-5 asks for this "for each of the three detected runners". Deriving the
  // commands from detectRunner rather than restating them as literals is what
  // makes the test fail if someone adds a filter to a detected command.
  it('every command detectRunner can choose classifies as full', async () => {
    const { detectRunner } = await import('../../../src/verify/runners/detect.js');
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');

    const LAYOUTS: Array<[string, string]> = [
      ['vitest.config.ts', 'export default {}'],
      ['jest.config.js', 'module.exports = {}'],
      ['pyproject.toml', '[project]\nname = "x"\n'],
    ];
    for (const [marker, body] of LAYOUTS) {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scope-detect-'));
      try {
        await fs.writeFile(path.join(root, marker), body);
        const spec = await detectRunner(root);
        expect(spec, `no runner detected for ${marker}`).not.toBeNull();
        const cmd = [spec?.cmd, ...(spec?.args ?? [])].join(' ');
        expect(classifyTestCommand(cmd).scope, `${marker} -> ${cmd}`).toBe('full');
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    }
  });

  it('reports the override source when a command was supplied', () => {
    expect(assessTestScope('python3 -m pytest -q').source).toBe('override');
    expect(assessTestScope('pytest tests/test_a.py').source).toBe('override');
  });

  it('classifies the override it was given', () => {
    expect(assessTestScope('pytest tests/test_a.py').scope).toBe('narrowed');
    expect(assessTestScope('make test').scope).toBe('unknown');
  });
});

// Issue #118a. The AMBIENT environment reaches the runner whatever the command
// string says, so an exported PYTEST_ADDOPTS narrows a command that names no
// filter. Inline assignments were already handled (#112); this is the same
// narrowing arriving from the surrounding shell, which is the form an agent or a
// CI env block can set without it appearing anywhere in the command.
describe('ambient option-carrying environment (#118a)', () => {
  it('narrows a full pytest command', () => {
    const a = assessTestScope('python3 -m pytest -q', { PYTEST_ADDOPTS: '-k test_scale' });
    expect(a.scope).toBe('narrowed');
    expect(a.signals.join(' ')).toContain('PYTEST_ADDOPTS');
  });

  it('narrows a DETECTED run too, where there is no command to inspect', () => {
    const a = assessTestScope(undefined, { PYTEST_ADDOPTS: '-k test_scale' });
    expect(a.scope).toBe('narrowed');
    expect(a.source).toBe('detected');
  });

  it('leaves a detected run alone when nothing is exported', () => {
    expect(assessTestScope(undefined, {})).toEqual({
      scope: 'full',
      source: 'detected',
      signals: [],
    });
  });

  it('ignores a value that carries no filter', () => {
    expect(
      assessTestScope('python3 -m pytest -q', { PYTEST_ADDOPTS: '-q --strict-markers' }).scope,
    ).toBe('full');
    expect(assessTestScope('python3 -m pytest -q', { PYTEST_ADDOPTS: '' }).scope).toBe('full');
  });

  // The gate that stops this becoming a false `narrowed` factory: the ambient
  // environment reaches EVERY command, so an exported PYTEST_ADDOPTS left in a
  // shell must not floor a JS project for a variable its runner never reads.
  it('is gated on the resolved runner', () => {
    expect(assessTestScope('npx vitest run', { PYTEST_ADDOPTS: '-k x' }).scope).toBe('full');
    expect(assessTestScope('npx jest', { PYTEST_ADDOPTS: '-k x' }).scope).toBe('full');
    expect(assessTestScope('npx vitest run', { VITEST_ADDOPTS: '-t x' }).scope).toBe('narrowed');
  });

  it('does not override a command that already names a filter', () => {
    const a = assessTestScope('pytest tests/test_a.py', { PYTEST_ADDOPTS: '-k x' });
    expect(a.scope).toBe('narrowed');
    expect(a.signals.join(' ')).toContain('tests/test_a.py');
  });

  it('leaves PYTHONPATH alone, which is not an option source', () => {
    expect(assessTestScope('python3 -m pytest -q', { PYTHONPATH: '.' }).scope).toBe('full');
  });
});
