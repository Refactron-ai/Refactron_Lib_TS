import { describe, it, expect } from 'vitest';
import { extractFailureIds } from '../../../src/verify/failure-ids.js';

describe('extractFailureIds (pytest)', () => {
  it('extracts node ids from FAILED summary lines, stripping the failure repr', () => {
    const stdout = [
      'F.F                                                                      [100%]',
      '=========================== short test summary info ============================',
      'FAILED test_demo.py::test_a - assert False',
      'FAILED test_demo.py::test_math - assert 1 == 2',
      '2 failed, 1 passed in 0.05s',
    ].join('\n');
    const ids = extractFailureIds(stdout);
    expect([...ids].sort()).toEqual(['test_demo.py::test_a', 'test_demo.py::test_math']);
  });

  it('captures class-scoped node ids', () => {
    const stdout = 'FAILED test_cls.py::TestFoo::test_x - assert False\n1 failed in 0.02s';
    expect(extractFailureIds(stdout).has('test_cls.py::TestFoo::test_x')).toBe(true);
  });

  it('captures ERROR collection lines (module import errors)', () => {
    const stdout = [
      '==================================== ERRORS ====================================',
      'ERROR test_collect_err.py',
      '!!!!!!!!!!!!!!!!!!!! Interrupted: 1 error during collection !!!!!!!!!!!!!!!!!!!!',
    ].join('\n');
    expect(extractFailureIds(stdout).has('test_collect_err.py')).toBe(true);
  });

  it('returns an empty set for an all-passing run', () => {
    expect(extractFailureIds('.... 4 passed in 0.10s').size).toBe(0);
  });
});

describe('extractFailureIds (vitest)', () => {
  it('extracts file > testName ids from vitest FAIL lines', () => {
    const stdout = [
      ' FAIL  tests/unit/a.test.ts > test a',
      'Error A',
      ' FAIL  tests/unit/b.test.ts > test b',
      'Error B',
      ' Test Files  2 failed (2)',
    ].join('\n');
    const ids = extractFailureIds(stdout);
    expect(ids.has('tests/unit/a.test.ts > test a')).toBe(true);
    expect(ids.has('tests/unit/b.test.ts > test b')).toBe(true);
  });

  it('does not treat passing vitest checkmarks as failures', () => {
    const stdout = [' ✓ tests/unit/a.test.ts > test a', ' Test Files  1 passed (1)'].join('\n');
    expect(extractFailureIds(stdout).size).toBe(0);
  });
});

describe('extractFailureIds (combined channels)', () => {
  it('unions stdout and stderr failure ids', () => {
    const ids = extractFailureIds('FAILED a.py::test_1 - boom', 'FAILED b.py::test_2 - boom');
    expect([...ids].sort()).toEqual(['a.py::test_1', 'b.py::test_2']);
  });
});
