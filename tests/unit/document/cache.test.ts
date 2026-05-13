import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as fs from 'node:fs/promises';
import { cacheKey, getCached, setCached } from '../../../src/document/cache.js';

const tmp: string[] = [];
afterEach(async () => {
  for (const d of tmp.splice(0)) {
    await fs.rm(d, { recursive: true, force: true });
  }
});

async function makeTmpDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'refactron-cache-'));
  tmp.push(d);
  return d;
}

describe('cacheKey', () => {
  it('produces a deterministic hex sha256 digest', () => {
    const k = cacheKey({
      provider: 'openai',
      model: 'gpt-4',
      templateVersion: 'v1',
      prompt: 'hello',
    });
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    const k2 = cacheKey({
      provider: 'openai',
      model: 'gpt-4',
      templateVersion: 'v1',
      prompt: 'hello',
    });
    expect(k2).toBe(k);
  });

  it('different prompts produce different keys', () => {
    const k1 = cacheKey({
      provider: 'openai',
      model: 'gpt-4',
      templateVersion: 'v1',
      prompt: 'hello',
    });
    const k2 = cacheKey({
      provider: 'openai',
      model: 'gpt-4',
      templateVersion: 'v1',
      prompt: 'world',
    });
    expect(k1).not.toBe(k2);
  });

  it('different providers/models/templateVersions produce different keys', () => {
    const base = {
      provider: 'openai',
      model: 'gpt-4',
      templateVersion: 'v1',
      prompt: 'hello',
    };
    expect(cacheKey(base)).not.toBe(cacheKey({ ...base, provider: 'anthropic' }));
    expect(cacheKey(base)).not.toBe(cacheKey({ ...base, model: 'gpt-3.5' }));
    expect(cacheKey(base)).not.toBe(cacheKey({ ...base, templateVersion: 'v2' }));
  });
});

describe('getCached / setCached', () => {
  it('round-trips: setCached then getCached returns the stored response', async () => {
    const dir = await makeTmpDir();
    const key = cacheKey({
      provider: 'openai',
      model: 'gpt-4',
      templateVersion: 'v1',
      prompt: 'roundtrip',
    });
    await setCached(dir, key, 'cached-response');
    const got = await getCached(dir, key);
    expect(got).toBe('cached-response');
  });

  it('shards by first two characters of the key', async () => {
    const dir = await makeTmpDir();
    const key = cacheKey({
      provider: 'p',
      model: 'm',
      templateVersion: 't',
      prompt: 'shard',
    });
    await setCached(dir, key, 'payload');
    const sharded = join(dir, key.slice(0, 2), key);
    const data = await fs.readFile(sharded, 'utf8');
    expect(data).toBe('payload');
  });

  it('getCached returns null when the file does not exist', async () => {
    const dir = await makeTmpDir();
    const got = await getCached(dir, 'a'.repeat(64));
    expect(got).toBeNull();
  });

  it('setCached does not throw when the parent path cannot be created', async () => {
    const dir = await makeTmpDir();
    const filePath = join(dir, 'sentinel');
    await fs.writeFile(filePath, 'x');
    // Try to use a regular file as a parent dir → mkdir should fail; setCached must swallow.
    await expect(setCached(filePath, 'a'.repeat(64), 'payload')).resolves.toBeUndefined();
  });
});
