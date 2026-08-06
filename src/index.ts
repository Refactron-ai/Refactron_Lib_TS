// src/index.ts
//
// The library entry point. package.json has pointed `main` and `types` at
// dist/index.js since before 0.2.0, but this file did not exist, so anything
// that did `import ... from 'refactron'` failed to resolve. Only the two bins
// were ever usable.
//
// The surface is deliberately narrow: diff in, verdict out. Every name here is
// one a consumer can actually construct or receive.
//
// Two things are deliberately NOT exported, and both were in the first draft of
// this file:
//
//   - `export * from './contracts.js'` published `TransformId` (20 literals
//     with no transforms left behind them), plus Finding, AnalysisReport,
//     Precondition, DocPatch and three engine interfaces that have no
//     implementation in this package. Each would become a breaking change to
//     remove, and `TransformId` is due to be narrowed in the next major:
//     exporting it now would export that break to consumers too.
//   - `RefactronVerifier` takes a `RefactorPlan`, whose `FileChange.transformId`
//     is a `TransformId`. A consumer cannot build one without writing
//     `'external-diff' as unknown as TransformId`, the cast the engine already
//     carries internally. Compiling exactly that against dist/index.d.ts fails
//     with TS2322, so the API could not be called. It stays internal until it
//     accepts something constructible.
export { verifyDiff } from './verify/verify-diff.js';
export type { VerifyDiffInput } from './verify/verify-diff.js';

// The input element type of VerifyDiffInput.edits. Object literals satisfy it
// structurally, but a consumer building an array in a helper needs to name it.
export type { FileEdit } from './verify/diff-input.js';

export type { VerdictReport, Verdict, CoverageAssessment } from './verify/verdict-fuse.js';

export { checkPythonSyntax } from './verify/checks/syntax-python.js';
export { checkTypescriptSyntax } from './verify/checks/syntax-typescript.js';

// The return type of both syntax checks.
export type { GateResult } from './contracts.js';

export { reportCoverage } from './analyze/coverage/index.js';
export type { CoverageReportInput, CoverageReport } from './analyze/coverage/index.js';
