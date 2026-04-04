// src/cli/components/WelcomeBanner.ts
// Returns the initial MessageLine[] shown in the REPL on startup.
// Shown as the first lines in the message history — never re-rendered.
import { theme } from '../../ui/theme.js';
import type { MessageLine } from './VirtualMessageList.js';

const W = 58; // inner width of the banner box

export function createWelcomeBanner(
  version: string,
  email?: string | null,
  plan?: string | null,
  adapterName?: string,
): MessageLine[] {
  let id = 0;
  const line = (text: string, color: string | undefined): MessageLine => ({
    id: id++,
    text,
    color,
  });

  const top = `  ╭${'─'.repeat(W)}╮`;
  const bottom = `  ╰${'─'.repeat(W)}╯`;
  const mid = `  ├${'─'.repeat(W)}┤`;
  const empty = `  │${' '.repeat(W)}│`;

  const logo1 = `  │  ◈  refactron${' '.repeat(W - 17 - version.length - 2)}v${version}  │`;
  const logo2 = `  │     safety-first refactoring${' '.repeat(W - 30)}│`;

  const lines: MessageLine[] = [
    line('', undefined),
    line(top, theme.colors.border),
    line(empty, theme.colors.border),
    line(logo1, theme.colors.accent),
    line(logo2, theme.colors.textDim),
    line(empty, theme.colors.border),
  ];

  if (email) {
    const planLabel = (plan ?? 'free').toUpperCase();
    const adapter = adapterName ? ` · ${adapterName}` : '';
    const userLine = `  │  ${theme.symbols.pass}  ${email}${adapter}${' '.repeat(Math.max(0, W - 5 - email.length - adapter.length))}│`;
    const planLine = `  │     Plan: ${planLabel}${' '.repeat(Math.max(0, W - 11 - planLabel.length))}│`;

    lines.push(
      line(mid, theme.colors.border),
      line(empty, theme.colors.border),
      line(userLine, theme.colors.success),
      line(planLine, theme.colors.textDim),
      line(empty, theme.colors.border),
    );
  }

  lines.push(
    line(bottom, theme.colors.border),
    line('', undefined),
    line('  Type help for commands  ·  Ctrl+C to exit', theme.colors.textDim),
    line('', undefined),
  );

  return lines;
}
