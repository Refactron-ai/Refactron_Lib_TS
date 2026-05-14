// src/verify/summarize-vitest.ts
// Parses vitest reporter output into a structured failure summary. The raw
// stdout that vitest emits on failure can be thousands of lines of noise;
// the CLI failure UX surfaces only the FAIL records + their first few lines
// of context, with the unparsed tail available as a fallback.

export interface VitestFailure {
  file: string;
  testName: string;
  /** Up to 10 lines of error context that follow the FAIL header. */
  message: string;
}

export interface VitestSummary {
  failures: VitestFailure[];
  suiteSummary: string | null;
}

const FAIL_LINE = /^\s*(?:FAIL|×|✗)\s+(\S+\.test\.[tj]sx?)\s*(?:>\s*(.+))?$/;
const SUITE_SUMMARY = /^\s*Test Files\s+\d+\s+failed.*$/;
const MAX_MESSAGE_LINES = 10;

export function summarizeVitestFailures(stdout: string): VitestSummary {
  const lines = stdout.split('\n');
  const failures: VitestFailure[] = [];
  let suiteSummary: string | null = null;

  let current: { file: string; testName: string; buffer: string[] } | null = null;

  const flush = (): void => {
    if (current === null) return;
    failures.push({
      file: current.file,
      testName: current.testName,
      message: current.buffer.join('\n'),
    });
    current = null;
  };

  for (const raw of lines) {
    const failMatch = raw.match(FAIL_LINE);
    if (failMatch) {
      flush();
      current = {
        file: failMatch[1] ?? '',
        testName: (failMatch[2] ?? '').trim(),
        buffer: [],
      };
      continue;
    }
    if (SUITE_SUMMARY.test(raw)) {
      flush();
      suiteSummary = raw.trim();
      continue;
    }
    if (current !== null) {
      if (raw.trim() === '') {
        // Allow blank lines inside the message but cap total lines below.
      }
      if (current.buffer.length < MAX_MESSAGE_LINES) {
        current.buffer.push(raw);
      }
    }
  }
  flush();
  return { failures, suiteSummary };
}
