import { describe, it, expect } from 'vitest';
import { parsePython } from '../../../../../src/analyze/parser.js';
import { detect } from '../../../../../src/analyze/detectors/python/datetime-timezone-utc.js';

const ctx = (s: string) => ({
  absPath: '/x/a.py',
  relPath: 'a.py',
  source: s,
  tree: parsePython(s),
});

describe('python: datetime-timezone-utc detector', () => {
  it('detects `datetime.timezone.utc` after `import datetime`', () => {
    const src = 'import datetime\nx = datetime.timezone.utc\n';
    const f = detect(ctx(src));
    expect(f).toHaveLength(1);
    expect(f[0]!.transformId).toBe('datetime_utc_alias');
    expect(f[0]!.confidence).toBe('high');
  });

  it('detects `timezone.utc` after `from datetime import timezone`', () => {
    const src = 'from datetime import timezone\nx = timezone.utc\n';
    expect(detect(ctx(src))).toHaveLength(1);
  });

  it('detects `dt.timezone.utc` after `import datetime as dt`', () => {
    const src = 'import datetime as dt\nx = dt.timezone.utc\n';
    expect(detect(ctx(src))).toHaveLength(1);
  });

  it('detects `tz.utc` after `from datetime import timezone as tz`', () => {
    // The detector surfaces the candidate; the transform is the one that
    // refuses the aliased-import form (so the user sees why a finding fired
    // but didn't produce a rewrite).
    const src = 'from datetime import timezone as tz\nx = tz.utc\n';
    expect(detect(ctx(src))).toHaveLength(1);
  });

  it('skips `datetime.timezone(timedelta(...))` constructor (not .utc)', () => {
    const src = [
      'import datetime',
      'from datetime import timedelta',
      'x = datetime.timezone(timedelta(hours=5))',
      '',
    ].join('\n');
    expect(detect(ctx(src))).toHaveLength(0);
  });

  it('skips `timezone.utc` without any matching import', () => {
    // No `import datetime` and no `from datetime import timezone` -- the
    // bare `timezone` identifier is presumed to be something else.
    const src = 'x = timezone.utc\n';
    expect(detect(ctx(src))).toHaveLength(0);
  });

  it('skips `datetime.timezone.utc` without `import datetime`', () => {
    // Without the import the module-alias check fails.
    const src = 'x = datetime.timezone.utc\n';
    expect(detect(ctx(src))).toHaveLength(0);
  });

  it('I1: ignores function-local `import datetime` — does NOT fire on module-level `datetime.timezone.utc`', () => {
    // A local `import datetime` inside a function body is NOT visible at
    // module scope, and the sidecar's `_collect_aliases` only looks at the
    // top-level body. The detector must mirror that scope rule or it will
    // surface a finding that the transform refuses, producing a user-visible
    // mismatch.
    const src = [
      'def f():',
      '    import datetime',
      '    return datetime.timezone.utc',
      'x = datetime.timezone.utc  # no top-level import in scope',
      '',
    ].join('\n');
    expect(detect(ctx(src))).toHaveLength(0);
  });
});
