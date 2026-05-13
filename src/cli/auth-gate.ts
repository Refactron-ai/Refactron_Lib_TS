// src/cli/auth-gate.ts
// One-shot CLI auth gate. Returns `true` if authenticated, otherwise an exit code.
import { loadCredentials, isAuthenticated } from '../auth/index.js';

export async function requireAuth(commandName: string): Promise<true | number> {
  const creds = await loadCredentials();
  if (!isAuthenticated(creds)) {
    process.stderr.write(
      `refactron ${commandName}: not authenticated.\n` +
        `  Run 'refactron login' locally, or set REFACTRON_TOKEN in your CI secrets.\n`,
    );
    return 7;
  }
  return true;
}
