import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildStatementMap, StatementMapError } from '../../../src/verify/statement-map.js';

function hasPython(): boolean {
  try {
    execSync('python3 --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
// `it.skipIf`, never an early return: an early return reports PASSED, so on a
// machine without python3 this whole file would go green while proving nothing.
const NO_PYTHON = !hasPython();

let root: string;
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'stmt-map-'));
});
afterAll(async () => {
  if (root) await fs.rm(root, { recursive: true, force: true });
});

/** Write `src` as `name` under the temp root and return its owner-per-line view,
 *  which is far easier to assert against than the run-length encoding. Index 0
 *  is unused; a line in no run reads back as `null` (INERT). */
async function ownersOf(name: string, src: string): Promise<Array<number | null>> {
  await fs.writeFile(path.join(root, name), src);
  const map = await buildStatementMap(root, [name]);
  expect(map.errors.get(name)).toBeUndefined();
  const runs = map.runs.get(name);
  expect(runs).toBeDefined();
  const owners: Array<number | null> = Array(src.split('\n').length + 1).fill(null);
  for (const run of runs ?? []) {
    for (let line = run.first; line <= run.last; line++) owners[line] = run.owner;
  }
  return owners;
}

describe('statement_map.py (AST line-to-statement containment)', () => {
  // Runs are consumed by binary search, so overlap or disorder would silently
  // return the wrong statement for a line. This is the contract, not a detail.
  it.skipIf(NO_PYTHON)('emits ascending, non-overlapping runs', async () => {
    await fs.writeFile(
      path.join(root, 'shape.py'),
      ['class C:', '    def m(self):', '        return [', '            1,', '        ]', ''].join(
        '\n',
      ),
    );
    const map = await buildStatementMap(root, ['shape.py']);
    const runs = map.runs.get('shape.py') ?? [];
    expect(runs.length).toBeGreaterThan(0);
    let previousEnd = 0;
    for (const run of runs) {
      expect(run.first).toBeGreaterThan(previousEnd);
      expect(run.last).toBeGreaterThanOrEqual(run.first);
      previousEnd = run.last;
    }
  });

  it.skipIf(NO_PYTHON)('a multi-line statement owns all of its continuation lines', async () => {
    const owners = await ownersOf(
      'wrapped.py',
      ['from math import (', '    ceil,', '    floor,', ')', ''].join('\n'),
    );
    expect(owners.slice(1, 5)).toEqual([1, 1, 1, 1]);
  });

  // The false SAFE in one assertion. Blank lines and comment-only lines carry no
  // code token, so they belong to no statement and can vouch for nothing.
  it.skipIf(NO_PYTHON)('blank and comment-only lines are INERT', async () => {
    const owners = await ownersOf(
      'inert.py',
      [
        'def f():', //          1
        '    # note', //        2
        '    return 1', //      3
        '', //                  4
        '', //                  5
        'def g():', //          6
        '    return 2', //      7
        '', //                  8
      ].join('\n'),
    );
    expect(owners[1]).toBe(1);
    expect(owners[2]).toBeNull(); // comment INSIDE f's extent, still inert
    expect(owners[3]).toBe(3);
    expect(owners[4]).toBeNull();
    expect(owners[5]).toBeNull();
    expect(owners[6]).toBe(6);
    expect(owners[7]).toBe(7);
  });

  // The tokenizer, not a textual blank test, decides. A blank line inside a
  // triple-quoted string is part of a STRING token and therefore real content;
  // calling it inert would silently drop a genuine change to that string.
  it.skipIf(NO_PYTHON)('a blank line INSIDE a docstring belongs to the docstring', async () => {
    const owners = await ownersOf(
      'doc.py',
      ['"""Title.', '', 'Body.', '"""', 'x = 1', ''].join('\n'),
    );
    expect(owners.slice(1, 5)).toEqual([1, 1, 1, 1]);
    expect(owners[5]).toBe(5);
  });

  // A comment inside a multi-line call sits inside the statement's extent but
  // carries no code, so it stays inert: it cannot change behavior, and letting
  // it inherit an executed statement is the exact false-SAFE mechanism.
  it.skipIf(NO_PYTHON)('a comment inside a multi-line call is still inert', async () => {
    const owners = await ownersOf(
      'call.py',
      ['x = foo(', '    # note', '    a,', ')', ''].join('\n'),
    );
    expect(owners[1]).toBe(1);
    expect(owners[2]).toBeNull();
    expect(owners[3]).toBe(1);
    expect(owners[4]).toBe(1);
  });

  // THE DEAD-BRANCH HOLE. coverage 7.11 reports a statement inside `if False:`
  // in NONE of executed/missing/excluded while the header IS in executed_lines,
  // so any walk-back mechanism lands on the header and vouches for folded code.
  it.skipIf(NO_PYTHON)('a statement inside `if False:` owns itself, not the header', async () => {
    const owners = await ownersOf(
      'dead.py',
      ['if False:', '    dead = 1', '    also = 2', ''].join('\n'),
    );
    expect(owners[1]).toBe(1);
    expect(owners[2]).toBe(2);
    expect(owners[3]).toBe(3);
  });

  it.skipIf(NO_PYTHON)(
    'a guarded import under `if TYPE_CHECKING:` owns its own lines',
    async () => {
      const owners = await ownersOf(
        'tc.py',
        [
          'from typing import TYPE_CHECKING', // 1
          '', //                                2
          'if TYPE_CHECKING:', //               3
          '    from decimal import (', //       4
          '        Context,', //                5
          '        Decimal,', //                6
          '    )', //                           7
          '', //                                8
        ].join('\n'),
      );
      // Line 3 executes at import time; 4..7 never do. They must not share an owner.
      expect(owners[3]).toBe(3);
      expect(owners.slice(4, 8)).toEqual([4, 4, 4, 4]);
    },
  );

  // `FunctionDef.lineno` points at `def`, so without folding decorators into the
  // definition's extent the `@deco` line would fall outside every statement.
  // coverage.py tracks the decorator line, so folding keeps the owner findable.
  it.skipIf(NO_PYTHON)('a decorator belongs to the definition it decorates', async () => {
    const owners = await ownersOf(
      'deco.py',
      ['@deco(', '    x=1,', ')', 'def f():', '    return 1', ''].join('\n'),
    );
    expect(owners.slice(1, 5)).toEqual([1, 1, 1, 1]);
    expect(owners[5]).toBe(5);
  });

  // `except X:` is a line coverage.py tracks in its own right. Without a unit for
  // it, a change to an except clause that never fired would be attributed to the
  // `try:` above, which did run.
  it.skipIf(NO_PYTHON)('an except clause owns its own line, not the try above it', async () => {
    const owners = await ownersOf(
      'tryex.py',
      ['try:', '    a = 1', 'except ValueError:', '    b = 2', ''].join('\n'),
    );
    expect(owners.slice(1, 5)).toEqual([1, 2, 3, 4]);
  });

  // Documented imprecision, pinned so it cannot drift unnoticed: `else:` and
  // `finally:` are not nodes in the grammar and coverage.py does not track them,
  // so the enclosing `try:` is the closest honest owner available. No diff can
  // change one of these lines on its own without touching real code too.
  it.skipIf(NO_PYTHON)('`else:` and `finally:` fall back to the enclosing try', async () => {
    const owners = await ownersOf(
      'clauses.py',
      [
        'try:', //               1
        '    a = 1', //          2
        'except ValueError:', // 3
        '    b = 2', //          4
        'else:', //              5
        '    c = 3', //          6
        'finally:', //           7
        '    d = 4', //          8
        '', //                   9
      ].join('\n'),
    );
    expect(owners[5]).toBe(1);
    expect(owners[6]).toBe(6);
    expect(owners[7]).toBe(1);
    expect(owners[8]).toBe(8);
  });

  it.skipIf(NO_PYTHON)('a `case` arm owns its own line, not the match header', async () => {
    const owners = await ownersOf(
      'match.py',
      [
        'def pick(v):', //          1
        '    match v:', //          2
        '        case 1:', //       3
        '            return "a"', //4
        '        case _:', //       5
        '            return "b"', //6
        '', //                      7
      ].join('\n'),
    );
    expect(owners[2]).toBe(2);
    expect(owners[3]).toBe(3);
    expect(owners[5]).toBe(5);
  });

  it.skipIf(NO_PYTHON)('lines past the last statement are inert', async () => {
    const owners = await ownersOf('tail.py', ['x = 1', '', '# trailing', '', ''].join('\n'));
    expect(owners[1]).toBe(1);
    expect(owners[2]).toBeNull();
    expect(owners[3]).toBeNull();
  });

  it.skipIf(NO_PYTHON)('a file with no statements at all yields no runs', async () => {
    await fs.writeFile(path.join(root, 'empty.py'), '# just a comment\n\n');
    const map = await buildStatementMap(root, ['empty.py']);
    expect(map.errors.size).toBe(0);
    expect(map.runs.get('empty.py')).toEqual([]);
  });

  describe('degradation', () => {
    // An unparseable file has no honest containment map. Reporting "no
    // statements" would make every changed line inert, i.e. a silent free pass;
    // the caller turns an error entry into UNKNOWN coverage instead.
    it.skipIf(NO_PYTHON)('a syntax error is reported as an error, never as zero runs', async () => {
      await fs.writeFile(path.join(root, 'broken.py'), 'def f(:\n    pass\n');
      const map = await buildStatementMap(root, ['broken.py']);
      expect(map.runs.has('broken.py')).toBe(false);
      expect(map.errors.get('broken.py')).toMatch(/SyntaxError/);
    });

    it.skipIf(NO_PYTHON)('a missing file is an error, not an empty map', async () => {
      const map = await buildStatementMap(root, ['does-not-exist.py']);
      expect(map.errors.has('does-not-exist.py')).toBe(true);
    });

    // One bad file must not cost the good ones their maps; the caller still
    // degrades the whole assessment, but on evidence rather than on a blank.
    it.skipIf(NO_PYTHON)('analyzes the good files alongside a bad one', async () => {
      await fs.writeFile(path.join(root, 'good.py'), 'x = 1\n');
      await fs.writeFile(path.join(root, 'bad.py'), 'def f(:\n');
      const map = await buildStatementMap(root, ['good.py', 'bad.py']);
      expect(map.runs.get('good.py')).toEqual([{ first: 1, last: 1, owner: 1 }]);
      expect(map.errors.has('bad.py')).toBe(true);
    });

    it.skipIf(NO_PYTHON)('an empty request does no work and returns empty maps', async () => {
      const map = await buildStatementMap(root, []);
      expect(map.runs.size).toBe(0);
      expect(map.errors.size).toBe(0);
    });

    // A sidecar we cannot run tells us NOTHING about which lines are inert, so it
    // must throw and let the caller report UNKNOWN coverage. Silently returning
    // an empty map would mark every changed line inert and hand out a free SAFE.
    it('a sidecar that cannot be spawned throws rather than returning an empty map', async () => {
      await fs.writeFile(path.join(root, 'whatever.py'), 'x = 1\n');
      await expect(
        buildStatementMap(root, ['whatever.py'], 'refactron-no-such-python-abc123'),
      ).rejects.toBeInstanceOf(StatementMapError);
    });
  });
});
