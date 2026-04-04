// src/cli/components/LoginFlow.tsx
// First-run / unauthenticated startup screen.
// Matches Claude Code's ConsoleOAuthFlow style:
//   - BannerLogo at top (mascot + product info)
//   - Clean inline text, no box-drawing borders
//   - Spinner while waiting for browser approval
//   - Prominent URL + code display during OAuth poll
import React, { useState, useCallback, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { theme } from '../../ui/theme.js';
import { runLoginFlow } from '../../auth/index.js';
import type { RefactronCredentials } from '../../auth/index.js';
import { Banner } from './Banner.js';

type LoginState = 'prompt' | 'running' | 'success' | 'denied' | 'error';

interface LoginFlowProps {
  onAuthenticated: (creds: RefactronCredentials) => void;
  onExit: () => void;
  version: string;
  adapterName?: string;
}

// Spinner frames for the "waiting for approval" animation
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function useSpinner(active: boolean): string {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setFrame((f) => (f + 1) % SPIN.length), 80);
    return () => clearInterval(t);
  }, [active]);
  return SPIN[frame] ?? '⠋';
}

export function LoginFlow({
  onAuthenticated,
  onExit,
  version,
  adapterName = 'auto',
}: LoginFlowProps): React.ReactElement {
  const { exit } = useApp();
  const [state, setState] = useState<LoginState>('prompt');
  const [statusMsg, setStatusMsg] = useState('');
  const [code, setCode] = useState('');
  const [url, setUrl] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [successEmail, setSuccessEmail] = useState('');
  const spinner = useSpinner(state === 'running');

  const appendStatus = useCallback((msg: string) => {
    if (msg.startsWith('Visit: ')) {
      setUrl(msg.replace('Visit: ', '').trim());
    } else if (msg.startsWith('Code:  ')) {
      setCode(msg.replace('Code:  ', '').trim());
    } else {
      setStatusMsg(msg);
    }
  }, []);

  const startLogin = useCallback(() => {
    setState('running');
    runLoginFlow(false, appendStatus)
      .then((creds) => {
        setSuccessEmail(creds.email ?? '');
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
      if (key.ctrl && inputChar === 'c') {
        onExit();
        exit();
        return;
      }
      if (state !== 'prompt') return;
      const ch = inputChar.toLowerCase();
      if (ch === 'y') {
        startLogin();
      } else if (ch === 'n' || key.escape) {
        setState('denied');
        setTimeout(() => { onExit(); exit(); }, 300);
      }
    },
    { isActive: process.stdin.isTTY === true },
  );

  return (
    <Box flexDirection="column">
      {/* ── Startup banner ───────────────────────────────────────── */}
      <Banner version={version} adapterName={adapterName} />

      {/* ── Auth section ─────────────────────────────────────────── */}
      <Box flexDirection="column" paddingLeft={2} gap={0}>

        {/* ── prompt: ask to log in ──────────────────────────────── */}
        {state === 'prompt' && (
          <Box flexDirection="column" gap={1}>
            <Text color={theme.colors.accent} bold>
              Welcome to Refactron!
            </Text>

            <Box flexDirection="column">
              <Text dimColor>Sign in to start refactoring safely.</Text>
              <Text dimColor>
                Refactron uses OAuth 2.0 — no password needed.
              </Text>
              <Text dimColor>
                Your browser will open to approve access.
              </Text>
            </Box>

            <Box gap={1}>
              <Text color={theme.colors.accent} bold>Log in to continue?</Text>
              <Text dimColor>[y / n]</Text>
              <Text color={theme.colors.accent}>█</Text>
            </Box>
          </Box>
        )}

        {/* ── running: show spinner + URL + code ────────────────── */}
        {state === 'running' && (
          <Box flexDirection="column" gap={1}>
            {!code ? (
              <Box gap={1}>
                <Text color={theme.colors.accent}>{spinner}</Text>
                <Text dimColor>Opening browser…</Text>
              </Box>
            ) : (
              <>
                <Box flexDirection="column">
                  <Text dimColor>Browser didn&apos;t open? Visit this URL:</Text>
                  <Box paddingLeft={2}>
                    <Text color={theme.colors.accent}>{url}</Text>
                  </Box>
                </Box>

                <Box flexDirection="column">
                  <Text dimColor>Verification code:</Text>
                  <Box paddingLeft={2}>
                    <Text color={theme.colors.accent} bold>{code}</Text>
                  </Box>
                </Box>

                <Box gap={1}>
                  <Text color={theme.colors.accent}>{spinner}</Text>
                  <Text dimColor>
                    {statusMsg !== '' ? statusMsg : 'Waiting for browser approval…'}
                  </Text>
                </Box>
              </>
            )}
          </Box>
        )}

        {/* ── success ───────────────────────────────────────────── */}
        {state === 'success' && (
          <Box flexDirection="column">
            <Box gap={1}>
              <Text color={theme.colors.success} bold>{theme.symbols.pass}</Text>
              <Text color={theme.colors.success} bold>
                Authenticated{successEmail !== '' ? ` as ${successEmail}` : ''}
              </Text>
            </Box>
            <Box paddingLeft={2}>
              <Text dimColor>Loading Refactron…</Text>
            </Box>
          </Box>
        )}

        {/* ── denied ────────────────────────────────────────────── */}
        {state === 'denied' && (
          <Text dimColor>Cancelled. Goodbye.</Text>
        )}

        {/* ── error ─────────────────────────────────────────────── */}
        {state === 'error' && (
          <Box flexDirection="column" gap={1}>
            <Box gap={1}>
              <Text color={theme.colors.error} bold>{theme.symbols.fail}</Text>
              <Text color={theme.colors.error} bold>Login failed</Text>
            </Box>
            <Box paddingLeft={2} flexDirection="column">
              <Text dimColor>{errorMsg}</Text>
              <Text dimColor>Run  refactron login  to try again.</Text>
            </Box>
          </Box>
        )}

      </Box>
    </Box>
  );
}
