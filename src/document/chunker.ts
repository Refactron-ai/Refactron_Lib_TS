// src/document/chunker.ts
/* eslint-disable @typescript-eslint/ban-types -- The public `Symbol` type name
 * matches the engine contract called out in the v2.0 documentation plan; the
 * built-in `Symbol` global is not referenced from this module. */
// Regex-based function/class boundary extractor for Python and TypeScript.
//
// Known limitations (v1 — accepted; future revision may swap in tree-sitter):
//   - Multi-line decorators with parens spanning lines are not consumed; the
//     header anchor is the def/class line itself.
//   - TypeScript arrow defaults containing literal "=>" (e.g.
//     `const f = (x = (a) => a) => ...`) can confuse the arrow detector.
//   - Nested Python functions are extracted using indent-based scoping; that
//     is best-effort and may collapse into the enclosing symbol.
//   - JS/TS object-method shorthand and assignment-style `const x = function`
//     are intentionally not matched.

export type SymbolKind = 'function' | 'class';

export interface Symbol {
  symbol: string;
  kind: SymbolKind;
  /** 1-indexed start line of the header. */
  startLine: number;
  /** 1-indexed inclusive end line of the symbol's span. */
  endLine: number;
  /** Best-effort: full text of the symbol's span in oldText. */
  oldText: string;
  /** Full text of the symbol's span in newText. */
  newText: string;
}

const PY_DEF_RE = /^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/;
const PY_CLASS_RE = /^(\s*)class\s+([A-Za-z_]\w*)\b/;
const TS_FN_RE = /^(\s*)(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_]\w*)\s*\(/;
const TS_CLASS_RE = /^(\s*)(?:export\s+)?class\s+([A-Za-z_]\w*)\b/;
const TS_ARROW_RE =
  /^(\s*)(?:export\s+)?const\s+([A-Za-z_]\w*)\s*=\s*(?:async\s*)?\(?[\w\s,:{}<>?'"=[\]|&]*\)?\s*=>/;

function sliceSpan(lines: string[], startLine: number, endLine: number): string {
  // startLine / endLine are 1-indexed inclusive.
  return lines.slice(startLine - 1, endLine).join('\n');
}

function indentOf(s: string): number {
  const m = /^(\s*)/.exec(s);
  return m && m[1] !== undefined ? m[1].length : 0;
}

interface Header {
  symbol: string;
  kind: SymbolKind;
  startLine: number; // 1-indexed
  indent: number;
}

function extractPython(text: string): Symbol[] {
  const lines = text.split('\n');
  const headers: Header[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const defMatch = PY_DEF_RE.exec(line);
    if (defMatch) {
      const indentStr = defMatch[1] ?? '';
      const name = defMatch[2];
      if (name !== undefined) {
        headers.push({
          symbol: name,
          kind: 'function',
          startLine: i + 1,
          indent: indentStr.length,
        });
        continue;
      }
    }
    const classMatch = PY_CLASS_RE.exec(line);
    if (classMatch) {
      const indentStr = classMatch[1] ?? '';
      const name = classMatch[2];
      if (name !== undefined) {
        headers.push({
          symbol: name,
          kind: 'class',
          startLine: i + 1,
          indent: indentStr.length,
        });
      }
    }
  }

  const results: Symbol[] = [];
  for (const h of headers) {
    // End-of-symbol = last line before the next non-blank line at indent <= h.indent.
    let endLine = lines.length; // default: end of file
    for (let j = h.startLine; j < lines.length; j++) {
      const ln = lines[j] ?? '';
      if (ln.trim() === '') continue;
      // Skip pure comment lines for boundary purposes? No: a top-level comment
      // at indent 0 below a `def` at indent 0 does terminate the symbol.
      if (indentOf(ln) <= h.indent) {
        endLine = j; // j is 0-indexed; the symbol ends at line j (1-indexed = j), i.e. line before j+1
        break;
      }
    }
    const span = sliceSpan(lines, h.startLine, endLine);
    results.push({
      symbol: h.symbol,
      kind: h.kind,
      startLine: h.startLine,
      endLine,
      oldText: '',
      newText: span,
    });
  }
  return results;
}

interface TsHeader extends Header {
  /** For arrow forms: true if header line ends with `=> expr` (no block body). */
  arrowExpr: boolean;
}

function extractTypeScript(text: string): Symbol[] {
  const lines = text.split('\n');
  const headers: TsHeader[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const fnMatch = TS_FN_RE.exec(line);
    if (fnMatch) {
      const name = fnMatch[2];
      const indentStr = fnMatch[1] ?? '';
      if (name !== undefined) {
        headers.push({
          symbol: name,
          kind: 'function',
          startLine: i + 1,
          indent: indentStr.length,
          arrowExpr: false,
        });
        continue;
      }
    }
    const classMatch = TS_CLASS_RE.exec(line);
    if (classMatch) {
      const name = classMatch[2];
      const indentStr = classMatch[1] ?? '';
      if (name !== undefined) {
        headers.push({
          symbol: name,
          kind: 'class',
          startLine: i + 1,
          indent: indentStr.length,
          arrowExpr: false,
        });
        continue;
      }
    }
    const arrowMatch = TS_ARROW_RE.exec(line);
    if (arrowMatch) {
      const name = arrowMatch[2];
      const indentStr = arrowMatch[1] ?? '';
      if (name !== undefined) {
        // Arrow body: either `=> {` (block) or `=> expr` (expression). We
        // detect block by looking at what comes after `=>` on the header line.
        const afterArrow = line.slice(line.indexOf('=>') + 2).trim();
        const arrowExpr = !afterArrow.startsWith('{');
        headers.push({
          symbol: name,
          kind: 'function',
          startLine: i + 1,
          indent: indentStr.length,
          arrowExpr,
        });
      }
    }
  }

  const results: Symbol[] = [];
  for (const h of headers) {
    let endLine = h.startLine;
    if (h.kind === 'function' && h.arrowExpr) {
      // Arrow with expression body: end at the first line ending with `;` or
      // at EOF if there's no terminator.
      endLine = lines.length;
      for (let j = h.startLine - 1; j < lines.length; j++) {
        const ln = lines[j] ?? '';
        if (ln.trimEnd().endsWith(';') || ln.trimEnd().endsWith(',')) {
          endLine = j + 1;
          break;
        }
        if (j === lines.length - 1) {
          endLine = j + 1;
        }
      }
    } else {
      // Brace tracking from the header line. Symbol ends when depth returns
      // to zero after we've opened at least one brace.
      let depth = 0;
      let opened = false;
      endLine = lines.length;
      for (let j = h.startLine - 1; j < lines.length; j++) {
        const ln = lines[j] ?? '';
        // Strip line comments and rough string literals to reduce false matches.
        const stripped = stripCommentsAndStrings(ln);
        for (const ch of stripped) {
          if (ch === '{') {
            depth++;
            opened = true;
          } else if (ch === '}') {
            depth--;
            if (opened && depth === 0) {
              endLine = j + 1;
              break;
            }
          }
        }
        if (opened && depth === 0) {
          endLine = j + 1;
          break;
        }
      }
    }
    const span = sliceSpan(lines, h.startLine, endLine);
    results.push({
      symbol: h.symbol,
      kind: h.kind,
      startLine: h.startLine,
      endLine,
      oldText: '',
      newText: span,
    });
  }
  return results;
}

function stripCommentsAndStrings(line: string): string {
  // Rough best-effort. Removes // line comments and contents inside matched
  // single/double/backtick quotes on the same line. Not a full lexer.
  let out = '';
  let i = 0;
  while (i < line.length) {
    const c = line[i] ?? '';
    const next = line[i + 1] ?? '';
    if (c === '/' && next === '/') break;
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i++;
      while (i < line.length) {
        const cc = line[i] ?? '';
        if (cc === '\\') {
          i += 2;
          continue;
        }
        if (cc === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

export function chunkByFunction(filePath: string, oldText: string, newText: string): Symbol[] {
  const lang = filePath.endsWith('.py')
    ? 'py'
    : filePath.endsWith('.ts') || filePath.endsWith('.tsx')
      ? 'ts'
      : null;
  if (!lang) return [];
  const oldSyms = lang === 'py' ? extractPython(oldText) : extractTypeScript(oldText);
  const newSyms = lang === 'py' ? extractPython(newText) : extractTypeScript(newText);
  const oldByName = new Map<string, Symbol>(oldSyms.map((s) => [s.symbol, s] as const));
  return newSyms.map((s) => {
    const prior = oldByName.get(s.symbol);
    return {
      ...s,
      oldText: prior?.newText ?? '',
    };
  });
}
