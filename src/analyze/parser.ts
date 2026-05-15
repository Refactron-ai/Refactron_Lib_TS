// Tree-sitter parsers are stateful instances. We cache one per language at module load
// so per-file calls don't re-allocate. tree-sitter parses fast (~10 MB/s); the win here
// is avoiding parser construction overhead, not parsing itself.

import Parser from 'tree-sitter';
// tree-sitter-python ships no types; the default export is an opaque grammar object.
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
import Python from 'tree-sitter-python';
// tree-sitter-typescript exposes `.typescript` and `.tsx` grammars; no types shipped.
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
import TSGrammars from 'tree-sitter-typescript';

let pyParser: Parser | null = null;
let tsParser: Parser | null = null;
let tsxParser: Parser | null = null;

function ensurePython(): Parser {
  if (!pyParser) {
    pyParser = new Parser();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    pyParser.setLanguage(Python);
  }
  return pyParser;
}

function ensureTypescript(): Parser {
  if (!tsParser) {
    tsParser = new Parser();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
    tsParser.setLanguage(TSGrammars.typescript);
  }
  return tsParser;
}

function ensureTsx(): Parser {
  if (!tsxParser) {
    tsxParser = new Parser();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
    tsxParser.setLanguage(TSGrammars.tsx);
  }
  return tsxParser;
}

// tree-sitter's native binding rejects a string input longer than ~32 KB
// with "Error: Invalid argument" (EINVAL). The callback-input form feeds the
// parser in chunks and has no size limit — and produces an identical tree —
// so we always use it. 16 KB chunks keep us well clear of the string cap.
const CHUNK = 1 << 14;

function parseChunked(parser: Parser, source: string): Parser.Tree {
  return parser.parse((index: number): string | null =>
    index < source.length ? source.slice(index, index + CHUNK) : null,
  );
}

export function parsePython(source: string): Parser.Tree {
  return parseChunked(ensurePython(), source);
}

export function parseTypescript(source: string, tsx: boolean): Parser.Tree {
  return parseChunked(tsx ? ensureTsx() : ensureTypescript(), source);
}
