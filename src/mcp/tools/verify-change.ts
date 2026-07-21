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
  testCmd: z.string().optional().describe('Override the test command'),
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
