// src/cli/format-safety.ts
// One-shot CLI presentation for the migration safety report. Returns
// RenderedLine[] (text + optional hex color hint) so the printer side
// (applyColor for stdout, Ink for the TUI) realizes color identically to
// the analyze formatter.
import type { SafetyReport, SafetyVerdict } from '../analyze/safety/verdict.js';
import type { RenderedLine } from './format-types.js';
import { theme } from '../ui/theme.js';

const VERDICT_LABEL: Record<SafetyVerdict, string> = {
  'safe-to-automate': 'SAFE',
  unproven: 'UNPROVEN',
  'needs-review': 'REVIEW',
};

const VERDICT_COLOR: Record<SafetyVerdict, string> = {
  'safe-to-automate': theme.colors.success,
  unproven: theme.colors.warning,
  'needs-review': theme.colors.error,
};

export function formatSafetyReport(report: SafetyReport): RenderedLine[] {
  const lines: RenderedLine[] = [];
  lines.push({ text: `Migration safety report — ${report.transformId}` });
  lines.push({ text: `  scanned ${report.root}`, color: theme.colors.textDim });
  if (report.total > 0 && !report.coverageAvailable) {
    lines.push({
      text: '  ⚠ coverage.py not available — every safe-shape site is UNPROVEN (cannot verify).',
      color: theme.colors.warning,
    });
  }
  lines.push({ text: '' });
  for (const s of report.sites) {
    const reason = s.flagReason ? ` (${s.flagReason})` : '';
    const cov =
      s.testCovered === 'yes'
        ? 'covered'
        : s.testCovered === 'no'
          ? 'uncovered'
          : 'coverage-unknown';
    lines.push({
      text: `  [${VERDICT_LABEL[s.verdict]}] ${s.file}:${s.line}${reason} — ${cov}`,
      color: VERDICT_COLOR[s.verdict],
    });
  }
  lines.push({ text: '' });
  lines.push({
    text:
      `  ${report.counts['safe-to-automate']} safe-to-automate · ` +
      `${report.counts.unproven} unproven · ` +
      `${report.counts['needs-review']} needs-review (of ${report.total})`,
  });
  return lines;
}

export function safetyReportToJson(report: SafetyReport): string {
  return JSON.stringify(report, null, 2);
}
