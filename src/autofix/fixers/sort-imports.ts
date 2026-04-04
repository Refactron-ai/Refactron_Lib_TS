import { BaseFixer } from './base.js';
import type { CodeIssue } from '../../core/models.js';
import type { TransformResult } from '../../adapters/interface.js';

export class SortImportsFixer extends BaseFixer {
  readonly name = 'sort-imports';
  readonly supportedIssueTypes = ['unsorted-imports'];

  async fix(_filePath: string, code: string, _issue: CodeIssue): Promise<TransformResult> {
    const lines = code.split('\n');
    const importLines: { line: string; idx: number }[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (/^import\s|^from\s/.test(lines[i] ?? ''))
        importLines.push({ line: lines[i] ?? '', idx: i });
    }
    if (importLines.length <= 1)
      return { transformedCode: code, description: 'Already sorted', riskLevel: 'low' };
    const sorted = [...importLines].sort((a, b) => a.line.localeCompare(b.line));
    const newLines = [...lines];
    importLines.forEach(({ idx }, i) => {
      newLines[idx] = sorted[i]?.line ?? '';
    });
    return {
      transformedCode: newLines.join('\n'),
      description: 'Sort imports alphabetically',
      riskLevel: 'low',
    };
  }
}
