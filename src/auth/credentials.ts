// src/auth/credentials.ts
// Credential storage — reads/writes ~/.refactron/credentials.json (chmod 0600)
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

export interface RefactronCredentials {
  api_base_url: string;
  access_token: string;
  token_type: string;
  expires_at: string | null; // ISO 8601
  email: string | null;
  plan: string | null; // "free" | "pro" | "enterprise"
  api_key: string | null;
}

const CREDENTIALS_DIR = path.join(os.homedir(), '.refactron');
const CREDENTIALS_FILE = path.join(CREDENTIALS_DIR, 'credentials.json');

export function isExpired(creds: RefactronCredentials): boolean {
  if (!creds.expires_at) return false;
  return new Date(creds.expires_at) <= new Date();
}

export function isAuthenticated(creds: RefactronCredentials | null): boolean {
  if (!creds) return false;
  // A long-lived Refactron API key always authenticates. API keys are issued
  // by refactron.dev's dashboard, carry no expiry, and can only be revoked
  // explicitly. Users who completed `refactron login` and received an
  // api_key alongside their access_token stay authenticated indefinitely —
  // the short-TTL OAuth access_token's expiry is irrelevant in that case.
  //
  // Before this fix: a user with a valid api_key got kicked out a few
  // minutes after `refactron login` because the access_token's expires_at
  // tripped, and isAuthenticated() ignored api_key entirely.
  if (creds.api_key && creds.api_key.length > 0) return true;
  // Otherwise fall back to OAuth access_token validity.
  if (!creds.access_token) return false;
  return !isExpired(creds);
}

export function envCredentials(): RefactronCredentials | null {
  const token = process.env.REFACTRON_TOKEN;
  if (!token) return null;
  return {
    api_base_url: process.env.REFACTRON_API_BASE_URL ?? 'https://api.refactron.dev',
    access_token: token,
    token_type: 'Bearer',
    expires_at: null,
    email: null,
    plan: 'free',
    api_key: null,
  };
}

export async function loadCredentials(): Promise<RefactronCredentials | null> {
  const env = envCredentials();
  if (env) return env;
  try {
    const raw = await fs.readFile(CREDENTIALS_FILE, 'utf-8');
    return JSON.parse(raw) as RefactronCredentials;
  } catch {
    return null;
  }
}

export async function saveCredentials(creds: RefactronCredentials): Promise<void> {
  await fs.mkdir(CREDENTIALS_DIR, { recursive: true });
  await fs.writeFile(CREDENTIALS_FILE, JSON.stringify(creds, null, 2), 'utf-8');
  // chmod 0600 — owner read/write only
  await fs.chmod(CREDENTIALS_FILE, 0o600);
}

export async function deleteCredentials(): Promise<void> {
  try {
    await fs.unlink(CREDENTIALS_FILE);
  } catch {
    // Already gone — no-op
  }
}
