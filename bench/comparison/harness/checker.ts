// checker.ts -- coverage checker for var-to-const-let.
//
// Inputs:
//   --fixture <dir>       Path to the (modified) fixture directory.
//   --expected <dir>      Path to the original (unmodified) fixture dir, which
//                         contains the *.expected.json sidecars.
//
// For each f<NN>.ts file:
//   - parse with ts-morph,
//   - find every VariableStatement,
//   - match each declarator to the expected.json site (by name + line),
//   - classify the rewrite as: correct, wrong, missed, or broken_syntax.
//
// Notes on mapping:
//   - We index expected sites by `name`. Many declarators share line numbers
//     when their declaration was multi-binding; we pair by (name, line) where
//     possible.
//   - If a tool collapses or splits multi-decl statements (some do), we still
//     match per-binding by name within the same scope.
//   - Modifications shift line numbers (e.g. comments or whitespace changes),
//     so we additionally match by name when (name, line) doesn't hit.
//
// Output:
//   JSON {correct, missed, wrong, broken_syntax, total_planted}

import { Project, SyntaxKind, Node, VariableDeclarationKind } from 'ts-morph';
import * as fs from 'node:fs';
import * as path from 'node:path';

type Outcome = 'const' | 'let' | 'skip';

interface ExpectedSite {
  line: number;
  name: string;
  expected: Outcome;
  alt?: Outcome;
  note?: string;
}

interface ExpectedFile {
  file: string;
  sites: ExpectedSite[];
}

function parseArgs(argv: string[]): { fixture: string; expected: string } {
  let fixture = '';
  let expected = '';
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--fixture') fixture = argv[++i];
    else if (argv[i] === '--expected') expected = argv[++i];
  }
  if (!fixture || !expected) {
    console.error('usage: checker.ts --fixture <dir> --expected <dir>');
    process.exit(2);
  }
  return { fixture, expected };
}

function loadExpected(expectedDir: string): Map<string, ExpectedFile> {
  const out = new Map<string, ExpectedFile>();
  for (const name of fs.readdirSync(expectedDir)) {
    if (!name.endsWith('.expected.json')) continue;
    const j = JSON.parse(fs.readFileSync(path.join(expectedDir, name), 'utf8')) as ExpectedFile;
    out.set(j.file, j);
  }
  return out;
}

function classify(
  fixtureDir: string,
  expectedFiles: Map<string, ExpectedFile>,
): {
  correct: number;
  missed: number;
  wrong: number;
  broken_syntax: number;
  total_planted: number;
  details: Array<{
    file: string;
    line: number;
    name: string;
    expected: Outcome;
    actual: Outcome | 'broken' | 'missing';
    verdict: 'correct' | 'missed' | 'wrong' | 'broken_syntax';
  }>;
} {
  let correct = 0;
  let missed = 0;
  let wrong = 0;
  let broken_syntax = 0;
  let total_planted = 0;
  const details: ReturnType<typeof classify>['details'] = [];

  // Process each expected file independently so a parse failure in one file
  // doesn't poison the others.
  for (const [filename, ef] of expectedFiles) {
    total_planted += ef.sites.length;
    const filepath = path.join(fixtureDir, filename);
    if (!fs.existsSync(filepath)) {
      // File removed -> every site missed.
      for (const site of ef.sites) {
        details.push({ file: filename, line: site.line, name: site.name, expected: site.expected, actual: 'missing', verdict: 'missed' });
        missed += 1;
      }
      continue;
    }

    let project: Project;
    let bindings: Array<{ name: string; line: number; kind: Outcome }>;
    try {
      project = new Project({ useInMemoryFileSystem: false, skipAddingFilesFromTsConfig: true });
      const sf = project.addSourceFileAtPath(filepath);
      bindings = [];
      // VariableStatement covers var/let/const at any depth -- but
      // sf.getVariableStatements() is top-level only. We need every
      // VariableStatement in the file, plus for-loop init bindings.
      sf.getDescendantsOfKind(SyntaxKind.VariableStatement).forEach((stmt) => {
        const kind = stmt.getDeclarationKind();
        const outcome: Outcome =
          kind === VariableDeclarationKind.Const ? 'const' : kind === VariableDeclarationKind.Let ? 'let' : 'skip';
        for (const d of stmt.getDeclarations()) {
          const id = d.getNameNode();
          const startLine = id.getStartLineNumber();
          bindings.push({ name: id.getText(), line: startLine, kind: outcome });
        }
      });
      // for-loop initializers: `for (var/let/const i = ...; ...)` -- these
      // are VariableDeclarationList inside ForStatement, not VariableStatement.
      sf.getDescendantsOfKind(SyntaxKind.ForStatement).forEach((forStmt) => {
        const init = forStmt.getInitializer();
        if (init && Node.isVariableDeclarationList(init)) {
          const kind = init.getDeclarationKind();
          const outcome: Outcome =
            kind === VariableDeclarationKind.Const ? 'const' : kind === VariableDeclarationKind.Let ? 'let' : 'skip';
          for (const d of init.getDeclarations()) {
            const id = d.getNameNode();
            bindings.push({ name: id.getText(), line: id.getStartLineNumber(), kind: outcome });
          }
        }
      });
      // for-of / for-in initializers.
      [...sf.getDescendantsOfKind(SyntaxKind.ForOfStatement), ...sf.getDescendantsOfKind(SyntaxKind.ForInStatement)].forEach((forStmt) => {
        const init = forStmt.getInitializer();
        if (init && Node.isVariableDeclarationList(init)) {
          const kind = init.getDeclarationKind();
          const outcome: Outcome =
            kind === VariableDeclarationKind.Const ? 'const' : kind === VariableDeclarationKind.Let ? 'let' : 'skip';
          for (const d of init.getDeclarations()) {
            const id = d.getNameNode();
            bindings.push({ name: id.getText(), line: id.getStartLineNumber(), kind: outcome });
          }
        }
      });
    } catch (err) {
      broken_syntax += ef.sites.length;
      for (const site of ef.sites) {
        details.push({ file: filename, line: site.line, name: site.name, expected: site.expected, actual: 'broken', verdict: 'broken_syntax' });
      }
      continue;
    }

    // Index actual bindings by name for matching.
    const actualByName = new Map<string, Array<{ line: number; kind: Outcome }>>();
    for (const b of bindings) {
      const arr = actualByName.get(b.name) ?? [];
      arr.push({ line: b.line, kind: b.kind });
      actualByName.set(b.name, arr);
    }
    // Track which actual bindings have been matched.
    const used = new WeakSet<object>();

    // Wrap each actual entry in an object so WeakSet can mark it.
    const wrappedByName = new Map<string, Array<{ line: number; kind: Outcome; key: object }>>();
    for (const [name, arr] of actualByName) {
      wrappedByName.set(
        name,
        arr.map((x) => ({ ...x, key: {} })),
      );
    }

    for (const site of ef.sites) {
      const candidates = wrappedByName.get(site.name) ?? [];
      // Prefer the candidate closest to the expected line that hasn't been used.
      let chosen: { line: number; kind: Outcome; key: object } | null = null;
      let bestDelta = Infinity;
      for (const c of candidates) {
        if (used.has(c.key)) continue;
        const delta = Math.abs(c.line - site.line);
        if (delta < bestDelta) {
          bestDelta = delta;
          chosen = c;
        }
      }
      if (chosen == null) {
        // Tool removed the declaration entirely -> if expected was 'skip', match.
        if (site.expected === 'skip') {
          correct += 1;
          details.push({ file: filename, line: site.line, name: site.name, expected: site.expected, actual: 'missing', verdict: 'correct' });
        } else {
          missed += 1;
          details.push({ file: filename, line: site.line, name: site.name, expected: site.expected, actual: 'missing', verdict: 'missed' });
        }
        continue;
      }
      used.add(chosen.key);
      const actual = chosen.kind;
      // Determine verdict.
      // If expected has alt (acceptable alternative), accept that too.
      const accept = new Set<Outcome>([site.expected]);
      if (site.alt) accept.add(site.alt);

      // 'skip' means the binding is still a `var` (tool left it alone).
      // For most tools we don't observe a `var` in the output (they were
      // either rewritten or left), so treat the `var`-survivor case as 'skip'.
      // ts-morph reports kind='skip' when getDeclarationKind isn't const/let,
      // i.e. it's still var.

      if (accept.has(actual)) {
        correct += 1;
        details.push({ file: filename, line: site.line, name: site.name, expected: site.expected, actual, verdict: 'correct' });
      } else if (site.expected === 'skip' && (actual === 'const' || actual === 'let')) {
        // The tool rewrote a site we said was unsafe -> wrong.
        wrong += 1;
        details.push({ file: filename, line: site.line, name: site.name, expected: site.expected, actual, verdict: 'wrong' });
      } else if ((site.expected === 'const' || site.expected === 'let') && actual === 'skip') {
        // The tool left a rewritable site alone -> missed.
        missed += 1;
        details.push({ file: filename, line: site.line, name: site.name, expected: site.expected, actual, verdict: 'missed' });
      } else {
        // const expected, got let (or vice versa) -> wrong.
        wrong += 1;
        details.push({ file: filename, line: site.line, name: site.name, expected: site.expected, actual, verdict: 'wrong' });
      }
    }
  }

  return { correct, missed, wrong, broken_syntax, total_planted, details };
}

const args = parseArgs(process.argv);
const expected = loadExpected(args.expected);
const result = classify(args.fixture, expected);
const includeDetails = process.env.CHECKER_DETAILS === '1';
process.stdout.write(
  JSON.stringify({
    correct: result.correct,
    missed: result.missed,
    wrong: result.wrong,
    broken_syntax: result.broken_syntax,
    total_planted: result.total_planted,
    ...(includeDetails ? { details: result.details } : {}),
  }) + '\n',
);
