// src/verify/mutation.ts
// Opt-in, downgrade-only mutation of the changed statements (ADR-15, #116).
//
// SAFE proves a changed line executed, not that any test asserts on it. This
// perturbs each changed conditional/arithmetic/boolean operator in the shadow
// tree and reruns the suite: a mutant the suite still passes (SURVIVES) is a
// changed statement no test would notice, so the verdict cannot be SAFE.
//
// The only verdict move this can cause is SAFE -> UNPROVEN. A killed mutant, an
// inconclusive one, and mutation-not-requested all strengthen nothing.
import { execa } from 'execa';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRunner } from './runners/run.js';
import { detectRunner } from './runners/detect.js';
import type { ChangedRange } from './diff-input.js';

const SIDECAR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'checks/_py/mutate.py');

export interface SurvivingMutant {
  file: string;
  line: number;
  mutation: string;
}

export interface MutationResult {
  ran: boolean;
  survivors: SurvivingMutant[];
  tested: number;
  killed: number;
  inconclusive: number;
  truncated?: { tested: number; total: number };
  skippedReason?: string;
}

interface Mutant {
  line: number;
  col: number;
  endCol: number;
  orig: string;
  repl: string;
  op: string;
}

export interface MutationInput {
  shadowRoot: string;
  ranges: ChangedRange[];
  testCmd?: string;
  pythonBin?: string;
  timeoutMs?: number;
  budget?: number;
}

const DEFAULT_BUDGET = 40;

async function mutantsFor(file: string, lines: number[], pythonBin: string): Promise<Mutant[]> {
  try {
    const r = await execa(pythonBin, [SIDECAR], {
      input: JSON.stringify({ path: file, changed_lines: lines }),
      timeout: 30_000,
      reject: false,
    });
    if (r.exitCode !== 0) return [];
    const parsed = JSON.parse(r.stdout) as Mutant[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Replace the mutant's operator in `content`, or null if the source at that
 *  span no longer matches — a guard against mutating a file the numbers do not
 *  describe, which would produce a meaningless survivor. */
function applyMutant(content: string, m: Mutant): string | null {
  const lines = content.split('\n');
  const idx = m.line - 1;
  if (idx < 0 || idx >= lines.length) return null;
  const line = lines[idx]!;
  if (line.slice(m.col, m.endCol) !== m.orig) return null;
  lines[idx] = line.slice(0, m.col) + m.repl + line.slice(m.endCol);
  return lines.join('\n');
}

export async function runMutation(input: MutationInput): Promise<MutationResult> {
  const empty: MutationResult = {
    ran: false,
    survivors: [],
    tested: 0,
    killed: 0,
    inconclusive: 0,
  };
  const pythonBin = input.pythonBin ?? 'python3';
  const budget = input.budget ?? DEFAULT_BUDGET;

  const spec = await detectRunner(input.shadowRoot, {
    ...(input.testCmd ? { override: input.testCmd } : {}),
    ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
  });
  if (spec === null) return { ...empty, skippedReason: 'no test runner to mutate against' };

  // A mutant is only meaningful against a GREEN baseline: kill vs survive is
  // defined by whether a mutant BREAKS a passing suite. If the plain suite is
  // not green here, mutation is inconclusive and must not downgrade.
  const baseline = await runRunner(spec);
  if (baseline.exitCode !== 0) {
    return { ...empty, skippedReason: 'baseline suite is not green under the plain test command' };
  }

  const all: Array<{ file: string; m: Mutant }> = [];
  for (const range of input.ranges) {
    if (range.lines.length === 0 || !range.path.endsWith('.py')) continue;
    const abs = path.resolve(input.shadowRoot, range.path);
    for (const m of await mutantsFor(abs, range.lines, pythonBin)) {
      all.push({ file: range.path, m });
    }
  }
  if (all.length === 0)
    return { ...empty, ran: true, skippedReason: 'no mutable operators in the changed statements' };

  const chosen = all.slice(0, budget);
  const survivors: SurvivingMutant[] = [];
  let killed = 0;
  let inconclusive = 0;

  for (const { file, m } of chosen) {
    const abs = path.resolve(input.shadowRoot, file);
    let original: string;
    try {
      original = await fs.readFile(abs, 'utf8');
    } catch {
      inconclusive += 1;
      continue;
    }
    const mutated = applyMutant(original, m);
    if (mutated === null) {
      inconclusive += 1;
      continue;
    }
    try {
      await fs.writeFile(abs, mutated);
      const r = await runRunner(spec);
      if (r.timedOut) inconclusive += 1;
      else if (r.exitCode === 0) survivors.push({ file, line: m.line, mutation: m.op });
      else killed += 1;
    } catch {
      inconclusive += 1;
    } finally {
      await fs.writeFile(abs, original);
    }
  }

  const result: MutationResult = {
    ran: true,
    survivors,
    tested: chosen.length,
    killed,
    inconclusive,
  };
  if (all.length > budget) result.truncated = { tested: budget, total: all.length };
  return result;
}
