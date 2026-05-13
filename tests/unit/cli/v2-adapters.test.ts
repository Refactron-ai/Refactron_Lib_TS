// tests/unit/cli/v2-adapters.test.ts
import { describe, it, expect } from 'vitest';
import type { DetectorFinding } from '../../../src/analyze/detectors/types.js';
import {
  findingToIssue,
  findingsToIssues,
  MESSAGE_BY_TRANSFORM,
  SUGGESTION_BY_TRANSFORM,
} from '../../../src/cli/v2-adapters.js';

function f(over: Partial<DetectorFinding> = {}): DetectorFinding {
  return {
    id: 'finding-1',
    file: 'src/a.py',
    line: 5,
    transformId: 'format_to_fstring',
    remediationMinutes: 2,
    confidence: 'high',
    ...over,
  };
}

describe('findingToIssue', () => {
  it('maps confidence to severity (high/medium/low)', () => {
    expect(findingToIssue(f({ confidence: 'high' })).severity).toBe('high');
    expect(findingToIssue(f({ confidence: 'medium' })).severity).toBe('medium');
    expect(findingToIssue(f({ confidence: 'low' })).severity).toBe('low');
  });

  it('renders a human message + suggestion per transform', () => {
    const issue = findingToIssue(f({ transformId: 'callback_to_async_await' }));
    expect(issue.message).toBe(MESSAGE_BY_TRANSFORM.callback_to_async_await);
    expect(issue.suggestion).toBe(SUGGESTION_BY_TRANSFORM.callback_to_async_await);
    expect(issue.type).toBe('callback_to_async_await');
    expect(issue.fixerName).toBe('callback_to_async_await');
    expect(issue.ruleId).toBe('refactron/callback_to_async_await');
  });

  it('marks every v2 issue as fixable', () => {
    expect(findingToIssue(f()).fixable).toBe(true);
  });

  it('stubs blastRadius with safe defaults (trivial / empty arrays / score 0)', () => {
    const issue = findingToIssue(f());
    expect(issue.blastRadius.level).toBe('trivial');
    expect(issue.blastRadius.score).toBe(0);
    expect(issue.blastRadius.affectedFiles).toEqual([]);
    expect(issue.blastRadius.affectedFunctions).toEqual([]);
    expect(issue.blastRadius.affectedTestFiles).toEqual([]);
  });

  it('findingsToIssues maps all findings preserving order', () => {
    const issues = findingsToIssues([
      f({ id: 'a' }),
      f({ id: 'b', transformId: 'var_to_const_let' }),
    ]);
    expect(issues).toHaveLength(2);
    expect(issues[0]!.id).toBe('a');
    expect(issues[1]!.id).toBe('b');
    expect(issues[1]!.type).toBe('var_to_const_let');
  });
});
