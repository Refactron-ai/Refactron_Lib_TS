import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import {
  buildReportModel,
  renderModernizationReport,
  reportPath,
  parseReportProse,
} from '../../../src/document/report.js';
import type { VerificationResult } from '../../../src/contracts.js';

function verified(): VerificationResult {
  return {
    passed: true,
    gates: {
      syntax: { passed: true, durationMs: 0 },
      imports: { passed: true, durationMs: 0 },
      tests: { passed: true, durationMs: 0 },
    },
    writableChanges: [
      {
        path: '/proj/src/a.py',
        oldHash: '',
        newContent: 'x = f"{y}"\n',
        transformId: 'format_to_fstring',
      },
    ],
  };
}

describe('buildReportModel', () => {
  it('builds one file entry with a diff and line stats', () => {
    const model = buildReportModel(
      verified(),
      new Map([['/proj/src/a.py', 'x = "%s" % y\n']]),
      '/proj',
    );
    expect(model.files).toHaveLength(1);
    expect(model.files[0]?.relPath).toBe('src/a.py');
    expect(model.files[0]?.transformId).toBe('format_to_fstring');
    expect(model.files[0]?.diff).toContain('f"{y}"');
  });
});

describe('renderModernizationReport', () => {
  it('renders summary, per-file, and verification sections', () => {
    const model = buildReportModel(
      verified(),
      new Map([['/proj/src/a.py', 'x = "%s" % y\n']]),
      '/proj',
    );
    const md = renderModernizationReport(
      model,
      { summary: 'Run summary.', files: { 'src/a.py': 'Behaviour-preserving.' } },
      { ok: true, rolledBack: [] },
      '2026-05-17',
    );
    expect(md).toContain('# Refactron Modernization Report — 2026-05-17');
    expect(md).toContain('## Summary');
    expect(md).toContain('Run summary.');
    expect(md).toContain('### src/a.py — format_to_fstring');
    expect(md).toContain('Behaviour-preserving.');
    expect(md).toContain('## Verification');
    expect(md).toContain('Post-apply syntax re-check: passed');
  });

  it('reports rolled-back files in the verification section', () => {
    const model = buildReportModel(verified(), new Map([['/proj/src/a.py', 'old\n']]), '/proj');
    const md = renderModernizationReport(
      model,
      { summary: '', files: {} },
      { ok: false, rolledBack: ['src/a.py'] },
      '2026-05-17',
    );
    expect(md).toContain('rolled back: src/a.py');
  });
});

describe('reportPath', () => {
  it('places the report under docs/refactron/', () => {
    // reportPath is a real filesystem path — assert OS-agnostically.
    expect(reportPath('/proj', '2026-05-17')).toBe(
      path.join('/proj', 'docs', 'refactron', 'modernization-2026-05-17.md'),
    );
  });
});

describe('parseReportProse', () => {
  it('parses a well-formed JSON object', () => {
    const p = parseReportProse('{"summary":"S","files":{"a.py":"why"}}');
    expect(p.summary).toBe('S');
    expect(p.files['a.py']).toBe('why');
  });

  it('returns an empty model for unparseable input', () => {
    expect(parseReportProse('garbage')).toEqual({ summary: '', files: {} });
  });
});
