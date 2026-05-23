import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  persistLastApply,
  loadLastApply,
  collapseChangesByPath,
  type LastApplySnapshot,
} from '../../../src/cli/last-apply.js';
import type { FileChange } from '../../../src/contracts.js';

describe('persistLastApply / loadLastApply', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'refactron-last-apply-'));
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('round-trips a snapshot through .refactron/last-apply.json', async () => {
    const snapshot: LastApplySnapshot = {
      projectRoot: tmp,
      verifiedAt: '2025-01-15T12:00:00.000Z',
      changes: [
        {
          path: path.join(tmp, 'a.ts'),
          oldContent: 'old\n',
          newContent: 'new\n',
          transformId: 'format_to_fstring',
        },
      ],
    };

    await persistLastApply(snapshot);
    const loaded = await loadLastApply(tmp);
    expect(loaded).toEqual(snapshot);
  });

  it('returns null when no snapshot is present', async () => {
    const loaded = await loadLastApply(tmp);
    expect(loaded).toBeNull();
  });
});

describe('collapseChangesByPath', () => {
  it('throws when an applied path has no captured original — refuses to store empty oldContent that would corrupt rollback', () => {
    const changes: FileChange[] = [
      {
        path: '/x/a.py',
        oldHash: 'h',
        newContent: 'after\n',
        transformId: 'super_no_args',
      },
    ];
    // originals deliberately missing the path — simulates a file that
    // became unreadable between plan and apply.
    expect(() => collapseChangesByPath(changes, new Map())).toThrow(
      /cannot record rollback for \/x\/a\.py/,
    );
  });
});
