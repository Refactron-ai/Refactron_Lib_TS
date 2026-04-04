// src/auth/device-auth.ts
// OAuth 2.0 Device Authorization Grant — API calls, polling loop.
// Same pattern as GitHub CLI / AWS CLI / VS Code.
import { spawnSync } from 'child_process';
import { saveCredentials } from './credentials.js';
import type { RefactronCredentials } from './credentials.js';

export const API_BASE_URL = 'https://api.refactron.dev';
export const APP_LOGIN_URL = 'https://app.refactron.dev/login';
const CLIENT_ID = 'refactron-cli';

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number; // seconds
  interval: number; // seconds between polls
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: {
    email: string;
    plan: string; // "free" | "pro" | "enterprise"
  };
}

export interface PollError {
  error: 'authorization_pending' | 'slow_down' | 'expired_token' | 'access_denied' | string;
  error_description?: string;
}

/** Step 1 — Request a device code from the server */
export async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  const res = await fetch(`${API_BASE_URL}/oauth/device`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID }),
  });

  if (!res.ok) {
    throw new Error(`Device auth request failed: ${res.status} ${res.statusText}`);
  }

  return (await res.json()) as DeviceCodeResponse;
}

/** Open the verification URL in the default browser (silent failure — user can open manually) */
export function openBrowser(url: string): void {
  const platform = process.platform;
  const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
  spawnSync(cmd, [url], { stdio: 'ignore' });
}

/** Step 2 — Poll for token until approved, expired, or deadline reached */
export async function pollForToken(
  deviceCode: string,
  expiresInSeconds: number,
  intervalSeconds: number,
  onWaiting?: () => void,
  sleepFn: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<TokenResponse> {
  const deadline = Date.now() + expiresInSeconds * 1000;
  let interval = intervalSeconds;

  while (Date.now() < deadline) {
    await sleepFn(interval * 1000);

    const res = await fetch(`${API_BASE_URL}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: deviceCode,
        client_id: CLIENT_ID,
      }),
    });

    const data = (await res.json()) as TokenResponse | PollError;

    if ('error' in data) {
      if (data.error === 'authorization_pending') {
        onWaiting?.();
        continue;
      }
      if (data.error === 'slow_down') {
        interval += 5;
        onWaiting?.();
        continue;
      }
      if (data.error === 'expired_token') {
        throw new Error('Device code expired. Run `refactron login` again.');
      }
      if (data.error === 'access_denied') {
        throw new Error('Login cancelled.');
      }
      throw new Error(data.error_description ?? data.error);
    }

    return data;
  }

  throw new Error('Login timed out (15 minutes). Run `refactron login` to try again.');
}

/** Validate API key for pro/enterprise plans */
export async function validateApiKey(accessToken: string, apiKey: string): Promise<boolean> {
  const res = await fetch(`${API_BASE_URL}/api-keys/validate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ api_key: apiKey }),
  });
  return res.ok;
}

/** Full login flow — returns saved credentials */
export async function runLoginFlow(
  noBrowser = false,
  onStatus?: (msg: string) => void,
): Promise<RefactronCredentials> {
  onStatus?.('Requesting device code…');

  let deviceResp: DeviceCodeResponse;
  try {
    deviceResp = await requestDeviceCode();
  } catch (err) {
    throw new Error(`Cannot reach Refactron API. Check your internet connection.\n${String(err)}`);
  }

  const loginUrl = `${APP_LOGIN_URL}?code=${deviceResp.user_code}`;
  onStatus?.(`Visit: ${loginUrl}`);
  onStatus?.(`Code:  ${deviceResp.user_code}`);

  if (!noBrowser) {
    openBrowser(loginUrl);
    onStatus?.('Browser opened. Waiting for approval…');
  } else {
    onStatus?.('Open the URL above in your browser to approve.');
  }

  let pollCount = 0;
  const token = await pollForToken(
    deviceResp.device_code,
    deviceResp.expires_in,
    deviceResp.interval,
    () => {
      pollCount++;
      if (pollCount % 6 === 0) {
        onStatus?.('Still waiting for browser approval…');
      }
    },
  );

  const expiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString();

  const creds: RefactronCredentials = {
    api_base_url: API_BASE_URL,
    access_token: token.access_token,
    token_type: token.token_type,
    expires_at: expiresAt,
    email: token.user.email,
    plan: token.user.plan,
    api_key: null,
  };

  await saveCredentials(creds);
  onStatus?.(`Logged in as ${token.user.email} (${token.user.plan} plan)`);

  return creds;
}
