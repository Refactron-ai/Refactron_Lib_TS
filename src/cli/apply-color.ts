// src/cli/apply-color.ts
// Minimal hex → basic ANSI mapping shared by the one-shot CLI formatters.
// Headless or NO_COLOR environments get plain text; otherwise we tint a
// handful of semantic colors. Intentionally tiny — full theme fidelity in
// the one-shot CLI isn't worth pulling chalk for.

import { theme } from '../ui/theme.js';

const ANSI_RESET = '\x1b[0m';

// Note: theme.colors.accent and theme.colors.brand share the same hex; we
// pick one ANSI mapping per hex value. theme.colors.text is left unmapped
// so default terminal foreground wins.
const HEX_TO_ANSI: Record<string, string> = {};
HEX_TO_ANSI[theme.colors.success] = '\x1b[32m'; // green
HEX_TO_ANSI[theme.colors.error] = '\x1b[31m'; // red
HEX_TO_ANSI[theme.colors.warning] = '\x1b[33m'; // yellow
HEX_TO_ANSI[theme.colors.accent] = '\x1b[36m'; // cyan
HEX_TO_ANSI[theme.colors.textDim] = '\x1b[90m'; // gray
HEX_TO_ANSI[theme.colors.border] = '\x1b[90m'; // gray
HEX_TO_ANSI[theme.severityColors.critical] = '\x1b[31m'; // red
HEX_TO_ANSI[theme.severityColors.high] = '\x1b[33m'; // yellow (closest basic match for orange)
HEX_TO_ANSI[theme.severityColors.medium] = '\x1b[33m'; // yellow
HEX_TO_ANSI[theme.severityColors.low] = '\x1b[32m'; // green

export function applyColor(text: string, color?: string): string {
  if (color === undefined) return text;
  if (process.env['NO_COLOR']) return text;
  if (!process.stdout.isTTY) return text;
  const code = HEX_TO_ANSI[color];
  if (!code) return text;
  return `${code}${text}${ANSI_RESET}`;
}
