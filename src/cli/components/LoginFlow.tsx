// src/cli/components/LoginFlow.tsx
// Full-screen OAuth Device Authorization flow.
// Shown when CLI starts without valid credentials.
import React, { useState, useCallback } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { theme } from '../../ui/theme.js';
import { runLoginFlow } from '../../auth/index.js';
import type { RefactronCredentials } from '../../auth/index.js';

type LoginState = 'prompt' | 'running' | 'success' | 'denied' | 'error';

interface LoginFlowProps {
  onAuthenticated: (creds: RefactronCredentials) => void;
  onExit: () => void;
  version: string;
}

const W = 56;
const BOX_TOP = `  ╭${'─'.repeat(W)}╮`;
const BOX_BOTTOM = `  ╰${'─'.repeat(W)}╯`;
const BOX_MID = `  ├${'─'.repeat(W)}┤`;
const BOX_EMPTY = `  │${' '.repeat(W)}│`;

function boxLine(text: string, color?: string): React.ReactElement {
  return <Text color={color ?? theme.colors.text}>{`  │  ${text.padEnd(W - 2)}│`}</Text>;
}

export function LoginFlow({
  onAuthenticated,
  onExit,
  version,
}: LoginFlowProps): React.ReactElement {
  const { exit } = useApp();
  const [state, setState] = useState<LoginState>('prompt');
  const [statusLines, setStatusLines] = useState<string[]>([]);
  const [code, setCode] = useState<string>('');
  const [url, setUrl] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState('');
  const [successEmail, setSuccessEmail] = useState('');

  const appendStatus = useCallback((msg: string) => {
    // Extract code and URL for prominent display
    if (msg.startsWith('Visit: ')) {
      setUrl(msg.replace('Visit: ', ''));
    } else if (msg.startsWith('Code:  ')) {
      setCode(msg.replace('Code:  ', ''));
    } else {
      setStatusLines((prev) => [...prev, msg]);
    }
  }, []);

  const startLogin = useCallback(() => {
    setState('running');
    runLoginFlow(false, appendStatus)
      .then((creds) => {
        setSuccessEmail(creds.email ?? '');
        setState('success');
        setTimeout(() => onAuthenticated(creds), 800);
      })
      .catch((err: unknown) => {
        setErrorMsg(String(err));
        setState('error');
      });
  }, [appendStatus, onAuthenticated]);

  useInput(
    (inputChar, key) => {
      if (state !== 'prompt') return;

      if (key.ctrl && inputChar === 'c') {
        onExit();
        exit();
        return;
      }

      const ch = inputChar.toLowerCase();
      if (ch === 'y') startLogin();
      else if (ch === 'n' || key.return) {
        setState('denied');
        setTimeout(() => {
          onExit();
          exit();
        }, 300);
      }
    },
    { isActive: process.stdin.isTTY === true },
  );

  return (
    <Box flexDirection="column">
      {/* ── Logo box ─────────────────────────────────────────────── */}
      <Text color={theme.colors.border}>{BOX_TOP}</Text>
      <Text color={theme.colors.border}>{BOX_EMPTY}</Text>
      <Text color={theme.colors.accent}>
        {`  │  ◈  refactron${' '.repeat(W - 17 - version.length - 2)}v${version}  │`}
      </Text>
      <Text color={theme.colors.textDim}>
        {`  │     safety-first refactoring${' '.repeat(W - 30)}│`}
      </Text>
      <Text color={theme.colors.border}>{BOX_EMPTY}</Text>
      <Text color={theme.colors.border}>{BOX_MID}</Text>
      <Text color={theme.colors.border}>{BOX_EMPTY}</Text>

      {/* ── Auth prompt ──────────────────────────────────────────── */}
      {state === 'prompt' && (
        <>
          {boxLine('Authentication required', theme.colors.warning)}
          {boxLine('')}
          {boxLine('Refactron uses OAuth 2.0 — no password needed.', theme.colors.textDim)}
          {boxLine('Your browser opens, you approve, done.', theme.colors.textDim)}
          {boxLine('')}
          <Text color={theme.colors.border}>{BOX_EMPTY}</Text>
          <Text>
            {`  │  `}
            <Text color={theme.colors.accent} bold>
              Log in to continue?{' '}
            </Text>
            <Text color={theme.colors.textDim}>[y / n] </Text>
            <Text color={theme.colors.accent}>█</Text>
            {`${' '.repeat(W - 24)}│`}
          </Text>
          <Text color={theme.colors.border}>{BOX_EMPTY}</Text>
        </>
      )}

      {/* ── Running — show code + URL prominently ────────────────── */}
      {state === 'running' && (
        <>
          {code ? (
            <>
              {boxLine('Open this URL in your browser:', theme.colors.textDim)}
              {boxLine('')}
              {boxLine(url, theme.colors.accent)}
              {boxLine('')}
              <Text color={theme.colors.border}>{BOX_MID}</Text>
              <Text color={theme.colors.border}>{BOX_EMPTY}</Text>
              {boxLine('Verification code:', theme.colors.textDim)}
              <Text>
                {`  │     `}
                <Text color={theme.colors.accent} bold>
                  {code}
                </Text>
                {`${' '.repeat(Math.max(0, W - 5 - code.length))}│`}
              </Text>
              <Text color={theme.colors.border}>{BOX_EMPTY}</Text>
              <Text color={theme.colors.border}>{BOX_MID}</Text>
              <Text color={theme.colors.border}>{BOX_EMPTY}</Text>
              {statusLines
                .slice(-2)
                .map((l, i) =>
                  boxLine(
                    l,
                    i === statusLines.length - 1 ? theme.colors.text : theme.colors.textDim,
                  ),
                )}
            </>
          ) : (
            <>{boxLine('Connecting to Refactron…', theme.colors.textDim)}</>
          )}
          <Text color={theme.colors.border}>{BOX_EMPTY}</Text>
        </>
      )}

      {/* ── Success ──────────────────────────────────────────────── */}
      {state === 'success' && (
        <>
          <Text>
            {`  │  `}
            <Text color={theme.colors.success} bold>
              {theme.symbols.pass} Authenticated — {successEmail}
            </Text>
            {`${' '.repeat(Math.max(0, W - 18 - successEmail.length))}│`}
          </Text>
          {boxLine('Loading Refactron…', theme.colors.textDim)}
          <Text color={theme.colors.border}>{BOX_EMPTY}</Text>
        </>
      )}

      {/* ── Denied ───────────────────────────────────────────────── */}
      {state === 'denied' && (
        <>
          {boxLine('Cancelled. Goodbye.', theme.colors.textDim)}
          <Text color={theme.colors.border}>{BOX_EMPTY}</Text>
        </>
      )}

      {/* ── Error ────────────────────────────────────────────────── */}
      {state === 'error' && (
        <>
          {boxLine(`${theme.symbols.fail}  Login failed`, theme.colors.error)}
          {boxLine(errorMsg.slice(0, W - 2), theme.colors.textDim)}
          {boxLine('')}
          {boxLine('Run  refactron login  to try again.', theme.colors.textDim)}
          <Text color={theme.colors.border}>{BOX_EMPTY}</Text>
        </>
      )}

      <Text color={theme.colors.border}>{BOX_BOTTOM}</Text>
    </Box>
  );
}
