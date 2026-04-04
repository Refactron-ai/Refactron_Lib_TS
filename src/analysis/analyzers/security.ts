// src/analysis/analyzers/security.ts
import type { AnalyzerConfig } from '../../core/config.js';
import { BaseAnalyzer, type AnalyzerResult } from './base.js';

const SECURITY_PATTERNS: Array<{
  pattern: RegExp;
  type: string;
  message: string;
  severity: 'critical' | 'high';
  fixable: boolean;
  ruleId: string;
}> = [
  {
    pattern: /cursor\.execute\s*\(\s*f['"]/g,
    type: 'sql-injection',
    message: 'f-string in cursor.execute() — use parameterized queries',
    severity: 'critical',
    fixable: false,
    ruleId: 'SEC001',
  },
  {
    pattern: /\beval\s*\(/g,
    type: 'dangerous-eval',
    message: 'eval() is dangerous — use safer alternatives',
    severity: 'high',
    fixable: false,
    ruleId: 'SEC002',
  },
  {
    pattern: /(?:password|secret|api_key|token)\s*=\s*['"][^'"]{8,}['"]/gi,
    type: 'hardcoded-secret',
    message: 'Hardcoded secret detected — use environment variables',
    severity: 'critical',
    fixable: false,
    ruleId: 'SEC003',
  },
  {
    pattern: /\bexec\s*\(/g,
    type: 'dangerous-exec',
    message: 'exec() can execute arbitrary code — avoid if possible',
    severity: 'high',
    fixable: false,
    ruleId: 'SEC004',
  },
];

export class SecurityAnalyzer extends BaseAnalyzer {
  readonly name = 'security';
  readonly rulePrefix = 'SEC';

  async analyze(filePath: string, code: string, _config: AnalyzerConfig): Promise<AnalyzerResult> {
    const lines = code.split('\n');
    const issues: AnalyzerResult['issues'] = [];

    for (const { pattern, type, message, severity, fixable, ruleId } of SECURITY_PATTERNS) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? '';
        pattern.lastIndex = 0;
        if (pattern.test(line)) {
          issues.push({
            id: this.makeIssueId(filePath, i + 1, type),
            file: filePath,
            line: i + 1,
            severity,
            type,
            message,
            suggestion: message,
            fixable,
            ruleId,
          });
        }
      }
    }

    return { issues };
  }
}
