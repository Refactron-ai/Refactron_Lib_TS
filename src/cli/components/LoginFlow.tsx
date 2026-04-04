// src/cli/components/LoginFlow.tsx
// Interactive OAuth Device Authorization flow rendered in the terminal.
// Shown when the CLI starts without valid credentials.
import React, { useState, useCallback } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { theme } from '../../ui/theme.js';
import { runLoginFlow } from '../../auth/index.js';
import type { RefactronCredentials } from '../../auth/index.js';

type LoginState =
  | 'prompt' // "Log in to continue? [y/n]"
  | 'running' // doing the OAuth flow
  | 'success'
  | 'denied' // user said no
  | 'error';

interface LoginFlowProps {
  onAuthenticated: (creds: RefactronCredentials) => void;
  onExit: () => void;
}

export function LoginFlow({ onAuthenticated, onExit }: LoginFlowProps): React.ReactElement {
  const { exit } = useApp();
  const [state, setState] = useState<LoginState>('prompt');
  const [statusLines, setStatusLines] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState('');

  const appendStatus = useCallback((msg: string) => {
    setStatusLines((prev) => [...prev, msg]);
  }, []);

  const startLogin = useCallback(() => {
    setState('running');
    runLoginFlow(false, appendStatus)
      .then((creds) => {
        setState('success');
        setTimeout(() => onAuthenticated(creds), 600);
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
      if (ch === 'y') {
        startLogin();
      } else if (ch === 'n' || key.return) {
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
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text color={theme.colors.accent} bold>
          {'  refactron '}
        </Text>
        <Text color={theme.colors.textDim}>— authentication required</Text>
      </Box>

      {/* Prompt */}
      {state === 'prompt' && (
        <Box flexDirection="column" gap={1}>
          <Text color={theme.colors.text}>You need to log in to use Refactron.</Text>
          <Text color={theme.colors.textDim}>
            This opens your browser for a quick one-time approval.
          </Text>
          <Box marginTop={1}>
            <Text color={theme.colors.accent} bold>
              Log in to continue?{' '}
            </Text>
            <Text color={theme.colors.textDim}>[y/n] </Text>
            <Text color={theme.colors.accent}>█</Text>
          </Box>
        </Box>
      )}

      {/* Running — show status stream */}
      {state === 'running' && (
        <Box flexDirection="column" gap={0}>
          {statusLines.map((line, i) => (
            <Text
              key={i}
              color={i === statusLines.length - 1 ? theme.colors.text : theme.colors.textDim}
            >
              {i === statusLines.length - 1 ? `  ${theme.symbols.arrow} ` : '    '}
              {line}
            </Text>
          ))}
          {statusLines.length === 0 && (
            <Text color={theme.colors.textDim}> Starting login flow…</Text>
          )}
        </Box>
      )}

      {/* Success */}
      {state === 'success' && (
        <Text color={theme.colors.success}>
          {theme.symbols.pass} Authenticated. Loading Refactron…
        </Text>
      )}

      {/* Denied */}
      {state === 'denied' && <Text color={theme.colors.textDim}> Cancelled. Goodbye.</Text>}

      {/* Error */}
      {state === 'error' && (
        <Box flexDirection="column" gap={1}>
          <Text color={theme.colors.error}>
            {theme.symbols.fail} Login failed: {errorMsg}
          </Text>
          <Text color={theme.colors.textDim}>
            Run <Text color={theme.colors.accent}>refactron login</Text> to try again.
          </Text>
        </Box>
      )}
    </Box>
  );
}
