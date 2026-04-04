// src/autofix/engine.ts
import type { CodeIssue } from '../core/models.js';
import type { TransformResult } from '../adapters/interface.js';
import type { IFixer } from './fixers/base.js';
import { UnusedImportsFixer } from './fixers/unused-imports.js';
import { TrailingWhitespaceFixer } from './fixers/trailing-whitespace.js';
import { NormalizeQuotesFixer } from './fixers/normalize-quotes.js';
import { SortImportsFixer } from './fixers/sort-imports.js';
import { DeadCodeFixer } from './fixers/dead-code.js';
import { TypeHintsFixer } from './fixers/type-hints.js';
import { MagicNumbersFixer } from './fixers/magic-numbers.js';
import { DocstringsFixer } from './fixers/docstrings.js';
import { SimplifyBooleanFixer } from './fixers/simplify-boolean.js';
import { ConvertFstringFixer } from './fixers/convert-fstring.js';
import { UnusedVariablesFixer } from './fixers/unused-variables.js';
import { FixIndentationFixer } from './fixers/fix-indentation.js';
import { MissingCommasFixer } from './fixers/missing-commas.js';
import { RemoveDebugFixer } from './fixers/remove-debug.js';

export class AutoFixEngine {
  private fixers: IFixer[] = [
    new UnusedImportsFixer(),
    new TrailingWhitespaceFixer(),
    new NormalizeQuotesFixer(),
    new SortImportsFixer(),
    new DeadCodeFixer(),
    new TypeHintsFixer(),
    new MagicNumbersFixer(),
    new DocstringsFixer(),
    new SimplifyBooleanFixer(),
    new ConvertFstringFixer(),
    new UnusedVariablesFixer(),
    new FixIndentationFixer(),
    new MissingCommasFixer(),
    new RemoveDebugFixer(),
  ];

  canFix(issue: CodeIssue): boolean {
    return this.fixers.some((f) => f.canFix(issue));
  }

  async fix(filePath: string, code: string, issue: CodeIssue): Promise<TransformResult | null> {
    const fixer = this.fixers.find((f) => f.canFix(issue));
    if (!fixer) return null;
    return fixer.fix(filePath, code, issue);
  }

  getFixerForIssue(issue: CodeIssue): IFixer | null {
    return this.fixers.find((f) => f.canFix(issue)) ?? null;
  }
}
