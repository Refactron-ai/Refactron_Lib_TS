// tests/unit/cli/report-file.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { writeRenderedReport, displayReportPath } from '../../../src/cli/report-file.js';

const tmp: string[] = [];
afterEach(async () => {
  for (const d of tmp.splice(0)) await fs.rm(d, { recursive: true, force: true });
});

describe('writeRenderedReport', () => {
  it('writes .refactron/reports/<command>-<id>.txt and returns its path', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-'));
    tmp.push(root);
    const abs = await writeRenderedReport({
      projectRoot: root,
      command: 'analyze',
      sessionId: 'abc123',
      lines: [{ text: 'first line' }, { text: 'second line' }],
    });
    expect(abs).toBe(path.join(root, '.refactron', 'reports', 'analyze-abc123.txt'));
    const content = await fs.readFile(abs, 'utf8');
    expect(content).toContain('first line');
    expect(content).toContain('second line');
    expect(content).toContain('refactron analyze'); // header
  });

  it('drops colors — the file is plain text', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-'));
    tmp.push(root);
    const abs = await writeRenderedReport({
      projectRoot: root,
      command: 'dry-run',
      sessionId: 'xyz',
      lines: [{ text: 'green add', color: '#3fb950' }],
    });
    const content = await fs.readFile(abs, 'utf8');
    expect(content).toContain('green add');
    expect(content).not.toContain('#3fb950');
    expect(content).not.toContain('\x1b['); // no ANSI escapes
  });
});

describe('displayReportPath', () => {
  it('returns a relative path for a file under cwd', () => {
    const p = path.join(process.cwd(), '.refactron', 'reports', 'analyze-1.txt');
    expect(displayReportPath(p)).toBe(path.join('.refactron', 'reports', 'analyze-1.txt'));
  });

  it('returns the absolute path for a file outside cwd', () => {
    const outside = path.join(os.tmpdir(), 'somewhere-else', 'r.txt');
    expect(displayReportPath(outside)).toBe(outside);
  });
});
