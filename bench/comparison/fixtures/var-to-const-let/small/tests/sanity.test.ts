// Safety suite: each fixture file must continue to behave as expected after
// any tool's rewrite. We exercise one or two functions per file with known
// inputs, asserting the same observable outputs.

import { describe, it, expect } from 'vitest';

import * as f01 from '../f01';
import * as f02 from '../f02';
import * as f03 from '../f03';
import * as f04 from '../f04';
import * as f05 from '../f05';
import * as f06 from '../f06';
import * as f07 from '../f07';
import * as f08 from '../f08';
import * as f09 from '../f09';
import * as f10 from '../f10';

describe('f01', () => {
  it('basic arithmetic + strings', () => {
    expect(f01.add(2, 3)).toBe(5);
    expect(f01.greet('world')).toBe('Hello, world!');
    expect(f01.double(7)).toBe(14);
    expect(f01.triangle(4)).toBe(10);
    expect(f01.repeat('a', 3)).toBe('aaa');
  });
});

describe('f02', () => {
  it('loops and accumulators', () => {
    expect(f02.sumTo(5)).toBe(15);
    expect(f02.countdown(3)).toEqual([3, 2, 1]);
    expect(f02.maxOf([1, 9, 3, 7])).toBe(9);
    expect(f02.joinWith(['a', 'b', 'c'], '-')).toBe('a-b-c');
    expect(f02.flipFlop(3)).toBe(true);
    expect(f02.lastNonZero([0, 5, 0, 7, 0])).toBe(7);
  });
});

describe('f03', () => {
  it('mixed', () => {
    expect(f03.compute(3)).toBe(60);
    expect(f03.formatLine('Ada', 36)).toBe('person / Ada / 36');
    expect(f03.bumpUntil(0, 5)).toBe(5);
    expect(f03.listOdd(7)).toEqual([1, 3, 5]);
    expect(f03.nameWith('mr', 'lee')).toBe('mr-lee');
    expect(f03.shrink(8)).toBe(1);
  });
});

describe('f04', () => {
  it('nested scopes', () => {
    expect(f04.nestedScope(3)).toBe(0 + 1 + 2 + 3 * 3);
    expect(f04.outerThenInner()).toBe('outer+inner');
    expect(f04.counterPair(3)).toEqual([3, 6]);
    expect(f04.shadowConst()).toBe(10 + 99);
    expect(f04.paramShadow(4)).toBe(16 + 8);
  });
});

describe('f05', () => {
  it('for-loops', () => {
    expect(f05.sumRange(1, 5)).toBe(10);
    expect(f05.product([2, 3, 4])).toBe(24);
    expect(f05.copyArray([1, 2, 3])).toEqual([1, 2, 3]);
    expect(f05.diagonal(3, 3)).toBe(3);
    expect(f05.firstMatch([1, 2, 3, 4], 3)).toBe(2);
    expect(f05.reverseInto([1, 2, 3])).toEqual([3, 2, 1]);
  });
});

describe('f06', () => {
  it('multi-decl', () => {
    expect(f06.pair()).toEqual([1, 2]);
    expect(f06.trio()).toEqual(['a', 'b', 'c']);
    expect(f06.lengths(['ab', 'cdef'])).toBe(2 + 4 + 4);
    expect(f06.firstTwo([10, 20, 30])).toEqual([10, 20]);
    expect(f06.describe('Ada', 'eng')).toBe('person: Ada: eng');
    expect(f06.counters()).toBe(5 + 10 + 15);
  });
});

describe('f07', () => {
  it('conditionals', () => {
    expect(f07.classify(1)).toBe('positive');
    expect(f07.classify(-1)).toBe('negative');
    expect(f07.classify(0)).toBe('zero');
    expect(f07.maybeBoost(3, true)).toBe(6);
    expect(f07.maybeBoost(3, false)).toBe(3);
    expect(f07.piecewise(-7)).toBe(7);
    expect(f07.piecewise(150)).toBe(100);
    expect(f07.piecewise(50)).toBe(50);
    expect(f07.tag('x', true)).toBe('[!]x.');
    expect(f07.clamp(50, 0, 10)).toBe(10);
    expect(f07.inferKind(3)).toBe('three');
    expect(f07.inferKind(4)).toBe('one');
    expect(f07.inferKind(5)).toBe('two');
  });
});

describe('f08', () => {
  it('hoisting + late reassign', () => {
    expect(f08.hoistDemo()).toBe(5);
    expect(f08.lateReassign(3)).toBe(6);
    expect(f08.plain(4)).toBe(8);
    expect(f08.blockedVar(2)).toBe(3);
    expect(f08.blockedVar(-1)).toBe(0);
  });
});

describe('f09', () => {
  it('try/catch + for-of', () => {
    expect(f09.trySafe('"hi"')).toBe('hi');
    expect(f09.trySafe('not json')).toBe('invalid');
    expect(f09.counted([1, 2, 3])).toBe(3);
    expect(f09.gather([1, 2, 3])).toEqual([1, 2, 3]);
    expect(f09.partition([10, 70, 20, 80])).toEqual({ lows: [10, 20], highs: [70, 80] });
    expect(f09.maxThrice([1, 5, 3])).toBe(5);
    expect(f09.safeDivide(10, 2)).toBe(5);
    expect(f09.safeDivide(10, 0)).toBe(0);
  });
});

describe('f10', () => {
  it('mixed mutation + counters', () => {
    expect(f10.buildList(3)).toEqual([0, 2, 4]);
    expect(f10.buildMap(['a', 'b'])).toEqual({ a: 0, b: 1 });
    expect(f10.tickUp(5)).toBe(5);
    expect(f10.tickDown(4)).toBe(0);
    expect(f10.compoundAssign(4)).toBe(0 + 1 + 2 + 3);
    expect(f10.chained()).toBe(3);
    expect(f10.bigArr(3)).toEqual([0, 1, 2]);
    expect(f10.untouchedConfig()).toEqual({ name: 'fixture', size: 10 });
    expect(f10.mutateInPlace()).toEqual([1, 2, 3]);
    expect(f10.loopUpdate([1, 2, 3, 4])).toBe(10);
  });
});
