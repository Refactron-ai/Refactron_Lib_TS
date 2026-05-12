import chalk from 'chalk';
import Table from 'cli-table3';
import type { ExtendedAnalysisReport } from '../engine.js';
import type { DetectorFinding } from '../detectors/types.js';

export function renderTerminal(report: ExtendedAnalysisReport): string {
  if (report.findings.length === 0) {
    return `${chalk.green('✓')} ${chalk.bold('0 findings')}\n`;
  }
  const byTransform = new Map<string, DetectorFinding[]>();
  for (const f of report.findings) {
    const arr = byTransform.get(f.transformId) ?? [];
    arr.push(f);
    byTransform.set(f.transformId, arr);
  }
  const lines: string[] = [];
  const total = report.findings.reduce((a, f) => a + f.remediationMinutes, 0);
  lines.push(
    `${chalk.bold(`${report.findings.length} findings`)} ${chalk.dim(`(~${total} min remediation)`)}`,
  );
  for (const [tid, items] of [...byTransform.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    lines.push('');
    lines.push(chalk.cyan(`▸ ${tid}`) + chalk.dim(` (${items.length})`));
    const table = new Table({
      head: [chalk.dim('file'), chalk.dim('line'), chalk.dim('conf')],
      style: { head: [], border: ['dim'] },
    });
    for (const f of items) {
      table.push([f.file, String(f.line), f.confidence]);
    }
    lines.push(table.toString());
  }
  return lines.join('\n') + '\n';
}
