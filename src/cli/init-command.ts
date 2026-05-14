// src/cli/init-command.ts
// Scaffolds a `.refactronrc.json` template into the target directory.
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { requireAuth } from './auth-gate.js';

const TEMPLATE = {
  $schema: 'https://refactron.dev/schema/refactronrc.json',
  transforms: ['all'],
  exclude: ['node_modules', 'dist', '.venv', '__pycache__'],
  testCmd: null,
  confidence: 'high',
  dryRun: true,
  // Default doc provider is the Refactron-managed backend — works out of
  // the box for any authenticated user. Switch to 'ollama' (local, free,
  // requires `brew install ollama`), 'groq' (BYOK via GROQ_API_KEY env
  // var), 'openai', or 'anthropic' if you prefer a different LLM.
  documentation: {
    provider: 'backend',
    model: 'llama-3.3-70b-versatile',
  },
};

export async function runInitCommand(argv: string[]): Promise<number> {
  const authResult = await requireAuth('init');
  if (authResult !== true) return authResult;
  const target = argv.find((a) => !a.startsWith('-')) ?? '.';
  const cfgPath = path.resolve(target, '.refactronrc.json');
  try {
    await fs.access(cfgPath);
    process.stderr.write(`refactron init: .refactronrc.json already exists at ${cfgPath}\n`);
    return 1;
  } catch {
    // doesn't exist — proceed
  }
  await fs.writeFile(cfgPath, JSON.stringify(TEMPLATE, null, 2) + '\n');
  process.stdout.write(`✓ created ${cfgPath}\n`);
  return 0;
}
