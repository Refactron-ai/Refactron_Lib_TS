// tests/integration/pipeline.test.ts
import { describe, it, expect } from 'vitest';
import { FixQueue } from '../../src/pipeline/queue.js';

describe('FixQueue', () => {
  it('enqueues and retrieves pending items', () => {
    const queue = new FixQueue();
    queue.enqueue(
      {
        id: 'test-1',
        file: 'app.py',
        line: 1,
        severity: 'low',
        type: 'unused-import',
        message: "'os' unused",
        fixable: true,
        fixerName: 'unused-imports',
        blastRadius: {
          affectedFiles: [],
          affectedFunctions: [],
          affectedTestFiles: [],
          score: 0,
          level: 'trivial',
        },
        ruleId: 'DEP001',
      },
      'unused-imports',
    );

    expect(queue.getPending()).toHaveLength(1);
    queue.updateStatus('test-1', 'APPLIED');
    expect(queue.getPending()).toHaveLength(0);
    expect(queue.getApplied()).toHaveLength(1);
  });

  it('tracks blocked items separately', () => {
    const queue = new FixQueue();
    queue.enqueue(
      {
        id: 'test-2',
        file: 'app.py',
        line: 5,
        severity: 'medium',
        type: 'high-complexity',
        message: 'High complexity',
        fixable: false,
        blastRadius: {
          affectedFiles: ['b.py'],
          affectedFunctions: [],
          affectedTestFiles: [],
          score: 10,
          level: 'low',
        },
        ruleId: 'CMP001',
      },
      'complexity',
    );

    queue.updateStatus('test-2', 'BLOCKED', { blockReason: 'verification failed' });
    expect(queue.getBlocked()).toHaveLength(1);
    expect(queue.getBlocked()[0]?.blockReason).toBe('verification failed');
  });
});
