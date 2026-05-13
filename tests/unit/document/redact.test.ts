import { describe, it, expect } from 'vitest';
import { redact } from '../../../src/document/redact.js';

describe('redact', () => {
  it('replaces AWS access key ids', () => {
    const input = 'key=AKIAIOSFODNN7EXAMPLE end';
    expect(redact(input, [])).toBe('key=[REDACTED:aws] end');
  });

  it('replaces OpenAI keys', () => {
    const input = 'token: sk-AbCdEfGhIjKlMnOpQrStUvWx';
    const out = redact(input, []);
    expect(out).toContain('[REDACTED:openai]');
    expect(out).not.toContain('sk-AbCdEfGhIjKlMnOpQrStUvWx');
  });

  it('replaces Anthropic keys before OpenAI matches them', () => {
    const input = 'export ANTHROPIC_API_KEY=sk-ant-api03-AbCdEfGhIjKlMnOpQrStUv';
    const out = redact(input, []);
    expect(out).toContain('[REDACTED:anthropic]');
    expect(out).not.toContain('[REDACTED:openai]');
  });

  it('replaces GitHub PATs', () => {
    const input = 'GH=ghp_abcdefghijklmnopqrstuvwxyz0123456789';
    expect(redact(input, [])).toContain('[REDACTED:github]');
  });

  it('replaces env-style secret assignments', () => {
    const input = 'DATABASE_PASSWORD=correcthorsebatterystaple1234';
    const out = redact(input, []);
    expect(out).toContain('[REDACTED:env]');
  });

  it('applies user-supplied custom patterns', () => {
    const input = 'internal=COMPANY-SECRET-123';
    const out = redact(input, ['COMPANY-SECRET-\\d+']);
    expect(out).toBe('internal=[REDACTED:custom]');
  });

  it('silently skips invalid custom regex without breaking built-ins', () => {
    const input = 'key=AKIAIOSFODNN7EXAMPLE';
    const out = redact(input, ['([unclosed']);
    expect(out).toContain('[REDACTED:aws]');
  });

  it('does not touch plain code assignments', () => {
    const input = 'x = 5\nlet name = "alice"\nreturn x + 1';
    expect(redact(input, [])).toBe(input);
  });

  it('replaces JWT-like tokens', () => {
    const a = 'A'.repeat(25);
    const b = 'B'.repeat(25);
    const c = 'C'.repeat(25);
    const input = `Authorization: Bearer ${a}.${b}.${c}`;
    const out = redact(input, []);
    expect(out).toContain('[REDACTED:jwt]');
  });
});
