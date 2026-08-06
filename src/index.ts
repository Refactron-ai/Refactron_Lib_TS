// src/index.ts
//
// The library entry point. package.json has pointed `main` and `types` at
// dist/index.js since before 0.2.0, but this file did not exist, so anything
// that did `import ... from 'refactron'` failed to resolve. Only the two bins
// were ever usable.
//
// The surface is deliberately small: the verdict pipeline, the two syntax
// checks, coverage reporting, and the contracts they speak in. Everything else
// stays internal so it can move without a major.
export { verifyDiff } from './verify/verify-diff.js';
export type { VerifyDiffInput } from './verify/verify-diff.js';

export { RefactronVerifier } from './verify/engine.js';

export type { VerdictReport } from './verify/verdict-fuse.js';

export { checkPythonSyntax } from './verify/checks/syntax-python.js';
export { checkTypescriptSyntax } from './verify/checks/syntax-typescript.js';

export { reportCoverage } from './analyze/coverage/index.js';

// The locked engine surface: Analyzer, Refactorer, Verifier, Documenter,
// RefactorPlan, FileChange, GateResult and the TransformId union.
export * from './contracts.js';
