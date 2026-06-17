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
});
