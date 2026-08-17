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

    it('running a script directly is unknown, not full', () => {
      expect(scopeOf('python3 run_tests.py')).toBe('unknown');
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

  describe('edge cases', () => {
    it('an empty command is unknown', () => {
      expect(scopeOf('')).toBe('unknown');
      expect(scopeOf('   ')).toBe('unknown');
    });

    it('quoted values are not read as positionals', () => {
      expect(scopeOf('npx jest --testNamePattern "adds two numbers"')).toBe('narrowed');
      expect(scopeOf('pytest -k "parser and not slow"')).toBe('narrowed');
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

  it('reports the override source when a command was supplied', () => {
    expect(assessTestScope('python3 -m pytest -q').source).toBe('override');
    expect(assessTestScope('pytest tests/test_a.py').source).toBe('override');
  });

  it('classifies the override it was given', () => {
    expect(assessTestScope('pytest tests/test_a.py').scope).toBe('narrowed');
    expect(assessTestScope('make test').scope).toBe('unknown');
  });
});
