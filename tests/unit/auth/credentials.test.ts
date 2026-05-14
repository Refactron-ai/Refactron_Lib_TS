// tests/unit/auth/credentials.test.ts
// Lock down the auth-status semantics. Specifically: a long-lived API key
// trumps the short-TTL OAuth access_token's expiry, so users who completed
// `refactron login` and received an api_key stay authenticated indefinitely.
//
// Before this regression test was added: a user with a valid api_key got
// kicked out a few minutes after login because isAuthenticated() ignored
// api_key entirely and only inspected access_token + expires_at.
import { describe, it, expect } from 'vitest';
import {
  isAuthenticated,
  isExpired,
  type RefactronCredentials,
} from '../../../src/auth/credentials.js';

function creds(overrides: Partial<RefactronCredentials> = {}): RefactronCredentials {
  return {
    api_base_url: 'https://api.refactron.dev',
    access_token: '',
    token_type: 'Bearer',
    expires_at: null,
    email: null,
    plan: null,
    api_key: null,
    ...overrides,
  };
}

describe('isAuthenticated', () => {
  it('returns false when creds is null', () => {
    expect(isAuthenticated(null)).toBe(false);
  });

  it('returns true when api_key is present, regardless of access_token state', () => {
    // Even with no access_token and an expired expires_at, a non-empty
    // api_key keeps the user authenticated.
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(
      isAuthenticated(creds({ api_key: 'rfk_live_abc', access_token: '', expires_at: past })),
    ).toBe(true);
  });

  it('returns true when api_key is present alongside an expired access_token (regression)', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(
      isAuthenticated(
        creds({ api_key: 'rfk_live_abc', access_token: 'expired_oauth', expires_at: past }),
      ),
    ).toBe(true);
  });

  it('treats an empty-string api_key as absent and falls back to access_token check', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(isAuthenticated(creds({ api_key: '', access_token: 'expired', expires_at: past }))).toBe(
      false,
    );
  });

  it('returns true when access_token is present and not expired (no api_key)', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(isAuthenticated(creds({ access_token: 'tok', expires_at: future }))).toBe(true);
  });

  it('returns true when access_token is present and expires_at is null (no api_key)', () => {
    // env-var-sourced credentials have no expiry; trust them.
    expect(isAuthenticated(creds({ access_token: 'tok', expires_at: null }))).toBe(true);
  });

  it('returns false when access_token is expired and no api_key', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(isAuthenticated(creds({ access_token: 'tok', expires_at: past }))).toBe(false);
  });

  it('returns false when no access_token AND no api_key', () => {
    expect(isAuthenticated(creds({ access_token: '', api_key: null }))).toBe(false);
  });
});

describe('isExpired', () => {
  it('returns false when expires_at is null (treated as never expires)', () => {
    expect(isExpired(creds({ expires_at: null }))).toBe(false);
  });
  it('returns true when expires_at is in the past', () => {
    expect(isExpired(creds({ expires_at: new Date(Date.now() - 1000).toISOString() }))).toBe(true);
  });
  it('returns false when expires_at is in the future', () => {
    expect(isExpired(creds({ expires_at: new Date(Date.now() + 60_000).toISOString() }))).toBe(
      false,
    );
  });
});
