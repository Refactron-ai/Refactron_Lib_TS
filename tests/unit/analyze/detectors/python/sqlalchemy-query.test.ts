import { describe, it, expect } from 'vitest';
import { parsePython } from '../../../../../src/analyze/parser.js';
import { detect } from '../../../../../src/analyze/detectors/python/sqlalchemy-query.js';

function ctxFor(source: string) {
  return {
    relPath: 'svc.py',
    absPath: '/tmp/svc.py',
    source,
    tree: parsePython(source),
  };
}

describe('sqlalchemy-query detector', () => {
  it('classifies session.query(M).filter(C).all() as safe', () => {
    const ctx = ctxFor(`
def list_active(session):
    return session.query(User).filter(User.active == True).all()
`);
    const findings = detect(ctx as never);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.transformId).toBe('sqlalchemy_query_to_select');
    expect((findings[0] as { meta: unknown }).meta).toEqual({ shape: 'safe' });
    expect(findings[0]!.confidence).toBe('medium');
  });

  const FLAG_CASES: Array<[string, string, string]> = [
    // [label, source, expectedFlagReason]
    ['multi-column-select', 'session.query(User.id, User.name).all()', 'multi-column-select'],
    [
      'joinedload-needs-unique',
      'session.query(User).options(joinedload(User.posts)).all()',
      'joinedload-needs-unique',
    ],
    [
      'bulk-update-semantics',
      'session.query(User).filter(User.active == False).update({"deleted": True})',
      'bulk-update-semantics',
    ],
    [
      'bulk-delete-semantics',
      'session.query(User).filter(User.id == 1).delete()',
      'bulk-delete-semantics',
    ],
    ['complex-joins (3+ joins)', 'session.query(A).join(B).join(C).join(D).all()', 'complex-joins'],
    [
      'select-entity-from',
      'session.query(User).select_entity_from(subq).all()',
      'select-entity-from',
    ],
  ];

  for (const [label, src, reason] of FLAG_CASES) {
    it(`classifies as flag: ${label}`, () => {
      const ctx = ctxFor(`def f(session): return ${src}`);
      const findings = detect(ctx as never);
      expect(findings).toHaveLength(1);
      expect((findings[0] as { meta: unknown }).meta).toEqual({
        shape: 'flag',
        flagReason: reason,
      });
    });
  }

  it('tags findings with testCovered=yes when the line is covered', () => {
    const source = `
def list_active(session):
    return session.query(User).filter(User.active == True).all()
`;
    const ctx = ctxFor(source);
    (ctx as { coveredLines?: Set<string> }).coveredLines = new Set(['svc.py:3']); // the query line
    const findings = detect(ctx as never);
    expect(findings[0]!.testCovered).toBe('yes');
  });

  it('tags findings with testCovered=no when the line is not covered', () => {
    const ctx = ctxFor(`
def list_active(session):
    return session.query(User).all()
`);
    (ctx as { coveredLines?: Set<string> }).coveredLines = new Set(['other.py:1']);
    const findings = detect(ctx as never);
    expect(findings[0]!.testCovered).toBe('no');
  });

  it('tags findings with testCovered=unknown when no coverage set was passed', () => {
    const ctx = ctxFor(`
def list_active(session):
    return session.query(User).all()
`);
    const findings = detect(ctx as never);
    expect(findings[0]!.testCovered).toBe('unknown');
  });

  describe('Flask-SQLAlchemy class-attr query head', () => {
    const SAFE_CASES: Array<[string, string]> = [
      ['filter().all()', 'User.query.filter(User.active == True).all()'],
      ['filter_by().first()', 'User.query.filter_by(active=True).first()'],
      ['get(pk)', 'User.query.get(user_id)'],
      ['filter().one()', 'User.query.filter(User.id == 1).one()'],
      ['terminal-only .all()', 'User.query.all()'],
    ];

    for (const [label, src] of SAFE_CASES) {
      it(`classifies as safe: ${label}`, () => {
        const ctx = ctxFor(`def f(): return ${src}`);
        const findings = detect(ctx as never);
        expect(findings).toHaveLength(1);
        expect((findings[0] as { meta: unknown }).meta).toEqual({ shape: 'safe' });
      });
    }

    const FLAG_CASES: Array<[string, string, string]> = [
      [
        'joinedload-needs-unique',
        'User.query.options(joinedload(User.posts)).all()',
        'joinedload-needs-unique',
      ],
      [
        'bulk-update-semantics',
        'User.query.filter(User.active == False).update({"deleted": True})',
        'bulk-update-semantics',
      ],
      [
        'bulk-delete-semantics',
        'User.query.filter(User.id == 1).delete()',
        'bulk-delete-semantics',
      ],
      ['complex-joins (3+ joins)', 'A.query.join(B).join(C).join(D).all()', 'complex-joins'],
      ['select-entity-from', 'User.query.select_entity_from(subq).all()', 'select-entity-from'],
    ];

    for (const [label, src, reason] of FLAG_CASES) {
      it(`classifies as flag: ${label}`, () => {
        const ctx = ctxFor(`def f(): return ${src}`);
        const findings = detect(ctx as never);
        expect(findings).toHaveLength(1);
        expect((findings[0] as { meta: unknown }).meta).toEqual({
          shape: 'flag',
          flagReason: reason,
        });
      });
    }

    it('does NOT flag class-attr form for multi-column-select (no head args)', () => {
      // Method form would flag session.query(User.id, User.name) as multi-column,
      // but class-attr form has no head args, so this case is structurally impossible.
      // Sanity test: the single-entity class-attr terminal stays safe.
      const ctx = ctxFor(`def f(): return User.query.all()`);
      const findings = detect(ctx as never);
      expect((findings[0] as { meta: unknown }).meta).toEqual({ shape: 'safe' });
    });

    it('emits exactly one finding for a chained class-attr expression', () => {
      // Both the outer .all() and the inner .filter(...) are `call` nodes; the
      // detector should fire only at the outer one (the inner is its function
      // attribute's receiver).
      const ctx = ctxFor(`def f(): return User.query.filter(User.active).all()`);
      const findings = detect(ctx as never);
      expect(findings).toHaveLength(1);
      expect(findings[0]!.line).toBeGreaterThan(0);
    });
  });
});
