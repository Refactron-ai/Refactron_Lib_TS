// src/cli/components/LoginFlow.tsx
// Auth flow state machine:
//   prompt → running → [api-key → verifying] → success
//                    ↘ denied / error
//
// api-key step only shown for pro/enterprise plans — masked input.
import React, { useState, useCallback, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { theme } from '../../ui/theme.js';
import {
  runLoginFlow,
  validateApiKey,
  needsApiKey,
  saveCredentials,
} from '../../auth/index.js';
import type { RefactronCredentials } from '../../auth/index.js';
import { WelcomeSplash } from './WelcomeSplash.js';

type LoginState =
  | 'prompt'
  | 'running'    // OAuth device flow polling
  | 'api-key'    // pro/enterprise: waiting for user to paste key
  | 'verifying'  // checking the pasted key against server
  | 'success'
  | 'denied'
  | 'error';

interface LoginFlowProps {
  onAuthenticated: (creds: RefactronCredentials) => void;
  onExit: () => void;
  version: string;
  adapterName?: string;
}

function useSpinner(active: boolean): string {
  const frames = theme.symbols.spinner; // ['·','✢','✳','✶','✻','✽', ...reverse]
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setFrame((f) => (f + 1) % frames.length), 80);
    return () => clearInterval(t);
  }, [active, frames.length]);
  return frames[frame] ?? '·';
}

export function LoginFlow({
  onAuthenticated,
  onExit,
  version,
  adapterName = 'auto',
}: LoginFlowProps): React.ReactElement {
  const { exit } = useApp();
  const [state, setState] = useState<LoginState>('prompt');

  // OAuth state
  const [statusMsg, setStatusMsg] = useState('');
  const [code, setCode] = useState('');
  const [url, setUrl] = useState('');
  const [urlCopied, setUrlCopied] = useState(false);

  // API key state
  const [pendingCreds, setPendingCreds] = useState<RefactronCredentials | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState(''); // raw (hidden from display)
  const [apiKeyError, setApiKeyError] = useState('');

  // Shared
  const [errorMsg, setErrorMsg] = useState('');
  const [successEmail, setSuccessEmail] = useState('');

  const spinner = useSpinner(state === 'running' || state === 'verifying');

  // ── OAuth status callback ──────────────────────────────────────────────
  const appendStatus = useCallback((msg: string) => {
    if (msg.startsWith('Visit: ')) setUrl(msg.replace('Visit: ', '').trim());
    else if (msg.startsWith('Code:  ')) setCode(msg.replace('Code:  ', '').trim());
    else setStatusMsg(msg);
  }, []);

  // ── Start OAuth ────────────────────────────────────────────────────────
  const startLogin = useCallback(() => {
    setState('running');
    runLoginFlow(false, appendStatus)
      .then(({ creds, requiresApiKey }) => {
        if (requiresApiKey) {
          // pro/enterprise — hold creds in state, go to key step
          setPendingCreds(creds);
          setState('api-key');
        } else {
          // free plan — done
          setSuccessEmail(creds.email ?? '');
          setState('success');
          setTimeout(() => onAuthenticated(creds), 600);
        }
      })
      .catch((err: unknown) => {
        setErrorMsg(String(err));
        setState('error');
      });
  }, [appendStatus, onAuthenticated]);

  // ── Verify API key ─────────────────────────────────────────────────────
  const submitApiKey = useCallback(
    (rawKey: string) => {
      const key = rawKey.trim();
      if (!key) {
        setApiKeyError('API key cannot be empty. Paste the key and press Enter.');
        return;
      }
      if (!pendingCreds) return;

      setState('verifying');
      setApiKeyError('');

      validateApiKey(key)
        .then(async (result) => {
          if (result.ok) {
            const finalCreds: RefactronCredentials = { ...pendingCreds, api_key: key };
            await saveCredentials(finalCreds);
            setSuccessEmail(finalCreds.email ?? '');
            setState('success');
            setTimeout(() => onAuthenticated(finalCreds), 600);
          } else {
            setApiKeyError(result.message);
            setApiKeyInput('');
            setState('api-key'); // let user retry
          }
        })
        .catch((err: unknown) => {
          setErrorMsg(String(err));
          setState('error');
        });
    },
    [pendingCreds, onAuthenticated],
  );

  // ── Copy URL to clipboard via OSC 52 ──────────────────────────────────
  const copyUrl = useCallback(() => {
    if (!url) return;
    try {
      const b64 = Buffer.from(url).toString('base64');
      process.stdout.write(`\x1b]52;c;${b64}\x07`);
      setUrlCopied(true);
      setTimeout(() => setUrlCopied(false), 2000);
    } catch { /* clipboard not supported in this terminal */ }
  }, [url]);

  // ── Global keys ────────────────────────────────────────────────────────
  useInput(
    (inputChar, key) => {
      // Ctrl+C always exits
      if (key.ctrl && inputChar === 'c') { onExit(); exit(); return; }

      // ── running state: C to copy URL ──────────────────────────────────
      if (state === 'running' && inputChar.toLowerCase() === 'c' && url) {
        copyUrl();
        return;
      }

      // ── prompt state ──────────────────────────────────────────────────
      if (state === 'prompt') {
        // Enter or 'y' → login (Enter = default yes)
        if (key.return || inputChar.toLowerCase() === 'y') { startLogin(); return; }
        if (inputChar.toLowerCase() === 'n' || key.escape) {
          setState('denied');
          setTimeout(() => { onExit(); exit(); }, 300);
        }
        return;
      }

      // ── api-key state: masked text input ──────────────────────────────
      if (state === 'api-key') {
        if (key.return) {
          submitApiKey(apiKeyInput);
          return;
        }
        if (key.backspace || key.delete) {
          setApiKeyInput((v) => v.slice(0, -1));
          return;
        }
        if (key.escape) {
          // Abort — nothing was saved
          setState('denied');
          setTimeout(() => { onExit(); exit(); }, 300);
          return;
        }
        // Reject control/meta combos
        if (key.ctrl || key.meta) return;
        if (inputChar && inputChar.length > 0) {
          setApiKeyInput((v) => v + inputChar);
        }
      }
    },
    { isActive: process.stdin.isTTY === true },
  );

  const maskedKey = '•'.repeat(apiKeyInput.length);

  return (
    <Box flexDirection="column">
      {/* WelcomeSplash: open WelcomeV2-style layout (no box borders) */}
      <WelcomeSplash version={version} />

      <Box flexDirection="column" paddingLeft={2} gap={1}>

        {/* ── prompt ──────────────────────────────────────────────────── */}
        {state === 'prompt' && (
          <Box flexDirection="column" gap={1}>
            <Box flexDirection="column">
              <Text dimColor>Sign in to start refactoring safely.</Text>
              <Text dimColor>Refactron uses OAuth 2.0 — no password needed.</Text>
              <Text dimColor>Your browser will open to approve access.</Text>
            </Box>
            <Box gap={1}>
              <Text color={theme.colors.brand} bold>Log in to continue?</Text>
              <Text dimColor>[</Text>
              <Text color={theme.colors.brand} bold>Y</Text>
              <Text dimColor>/ n]</Text>
              <Text color={theme.colors.brand}>█</Text>
            </Box>
            <Text dimColor>Press Enter to open browser</Text>
          </Box>
        )}

        {/* ── running: OAuth polling ───────────────────────────────────── */}
        {state === 'running' && (
          <Box flexDirection="column" gap={1}>
            {!code ? (
              <Box gap={1}>
                <Text color={theme.colors.brand}>{spinner}</Text>
                <Text dimColor>Opening browser…</Text>
              </Box>
            ) : (
              <>
                <Box flexDirection="column">
                  <Text dimColor>Browser didn&apos;t open? Visit:</Text>
                  <Box paddingLeft={2}>
                    {/* Underlined URL — ANSI \x1b[4m underline */}
                    <Text color={theme.colors.brand}>{`\x1b[4m${url}\x1b[24m`}</Text>
                  </Box>
                  {url && (
                    <Box paddingLeft={2}>
                      <Text dimColor>
                        {urlCopied ? '✔ Copied!' : 'Press C to copy URL'}
                      </Text>
                    </Box>
                  )}
                </Box>
                <Box flexDirection="column">
                  <Text dimColor>Verification code:</Text>
                  <Box paddingLeft={2}>
                    <Text color={theme.colors.brand} bold>{code}</Text>
                  </Box>
                </Box>
                <Box gap={1}>
                  <Text color={theme.colors.brand}>{spinner}</Text>
                  <Text dimColor>{statusMsg !== '' ? statusMsg : 'Waiting for browser approval…'}</Text>
                </Box>
              </>
            )}
          </Box>
        )}

        {/* ── api-key: masked input ────────────────────────────────────── */}
        {(state === 'api-key' || state === 'verifying') && (
          <Box flexDirection="column" gap={1}>
            <Box flexDirection="column">
              <Text color={theme.colors.brand} bold>API key required</Text>
              <Text dimColor>
                Your{' '}
                <Text color={theme.colors.brand}>
                  {(pendingCreds?.plan ?? 'pro').toUpperCase()}
                </Text>
                {' '}plan requires an API key.
              </Text>
              <Text dimColor>
                Generate one in the Refactron web app and paste it below.
              </Text>
            </Box>

            {/* Masked input row */}
            <Box gap={1}>
              <Text dimColor>API key:</Text>
              <Text color={theme.colors.text}>{maskedKey}</Text>
              {state === 'api-key' && (
                <Text color={theme.colors.brand}>█</Text>
              )}
            </Box>

            {state === 'verifying' && (
              <Box gap={1}>
                <Text color={theme.colors.brand}>{spinner}</Text>
                <Text dimColor>Verifying…</Text>
              </Box>
            )}

            {apiKeyError !== '' && state === 'api-key' && (
              <Box gap={1}>
                <Text color={theme.colors.error}>{theme.symbols.fail}</Text>
                <Text color={theme.colors.error}>{apiKeyError}</Text>
              </Box>
            )}

            {state === 'api-key' && (
              <Text dimColor>Press Enter to verify · Esc to cancel</Text>
            )}
          </Box>
        )}

        {/* ── success ─────────────────────────────────────────────────── */}
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

        {/* ── denied ──────────────────────────────────────────────────── */}
        {state === 'denied' && (
          <Text dimColor>Cancelled. Goodbye.</Text>
        )}

        {/* ── error ───────────────────────────────────────────────────── */}
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
