// src/mcp/tools/verify-change.ts
// The `verify_change` MCP tool: verify a proposed change (Mode A) and return a
// structured SAFE/UNSAFE/UNPROVEN verdict. Runs entirely local; never mutates
// the caller's repo. Handler is exported separately so it is unit-testable.
import { z } from 'zod';
import { verifyDiff, type VerifyDiffInput } from '../../verify/verify-diff.js';

export const verifyChangeInputSchema = {
  repoRoot: z.string().describe('Absolute path to the repository root'),
  edits: z
    .array(z.object({ path: z.string(), newContent: z.string() }))
    .optional()
    .describe('Proposed full-file contents (one of edits/unifiedDiff required)'),
  unifiedDiff: z.string().optional().describe('A unified/git diff to verify'),
  // This string is what an AI agent reads before choosing a command, and an
  // agent choosing its own command IS the threat model ADR-12 exists for. Kept
  // to two sentences: it is spent from every agent's context on every tool
  // listing, so it competes with the tool description itself.
  testCmd: z
    .string()
    .optional()
    .describe(
      'Override the test command. Must run the WHOLE suite: naming test paths or using -k/-m/-t/--onlyChanged/--collect-only caps the verdict at UNPROVEN. A PYTHONPATH= prefix is fine.',
    ),
};

export interface VerifyChangeArgs {
  repoRoot: string;
  edits?: Array<{ path: string; newContent: string }>;
  unifiedDiff?: string;
  testCmd?: string;
}

export async function handleVerifyChange(
  args: VerifyChangeArgs,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  try {
    const input: VerifyDiffInput = {
      repoRoot: args.repoRoot,
      ...(args.edits ? { edits: args.edits } : {}),
      ...(args.unifiedDiff ? { unifiedDiff: args.unifiedDiff } : {}),
      ...(args.testCmd ? { testCmd: args.testCmd } : {}),
    };
    const report = await verifyDiff(input);
    return { content: [{ type: 'text', text: JSON.stringify(report, null, 2) }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text', text: `verify_change failed: ${message}` }], isError: true };
  }
}
