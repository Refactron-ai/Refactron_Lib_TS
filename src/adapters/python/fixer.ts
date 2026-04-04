// src/adapters/python/fixer.ts
import type { CodeIssue } from '../../core/models.js';
import type { TransformResult } from '../interface.js';

export async function transformPythonCode(
  _file: string,
  code: string,
  issue: CodeIssue,
): Promise<TransformResult> {
  if (issue.fixerName === 'unused-imports') {
    return removeUnusedImport(code, issue);
  }

  if (issue.fixerName === 'trailing-whitespace') {
    return {
      transformedCode: code.replace(/[ \t]+$/gm, ''),
      description: 'Remove trailing whitespace',
      riskLevel: 'low',
    };
  }

  return {
    transformedCode: code,
    description: 'No transformation available',
    riskLevel: 'low',
  };
}

function removeUnusedImport(code: string, issue: CodeIssue): TransformResult {
  const importName = issue.message.match(/'(\w+)' is imported/)?.[1];
  if (!importName) {
    return {
      transformedCode: code,
      description: 'Could not identify import to remove',
      riskLevel: 'low',
    };
  }

  const lines = code.split('\n');
  const filtered = lines.filter((line, i) => {
    if (i !== issue.line - 1) return true;
    return !new RegExp(
      `^(?:import\\s+${importName}|from\\s+\\S+\\s+import\\s+${importName})\\s*$`,
    ).test(line);
  });

  return {
    transformedCode: filtered.join('\n'),
    description: `Remove unused import '${importName}'`,
    riskLevel: 'low',
  };
}
