import { describe, it, expect } from 'vitest';
import { CallScheduler, WindowLimiter } from '../../../src/document/scheduler.js';
import { ProviderError } from '../../../src/document/types.js';

describe('CallScheduler', () => {
  it('bounds in-flight calls to maxConcurrency', async () => {
    const s = new CallScheduler({
      maxConcurrency: 2,
      requestsPerMinute: 10000,
      tokensPerMinute: 10_000_000,
      maxRetries: 0,
      baseDelayMs: 1,
    });
    let active = 0;
    let peak = 0;
    const task = async (): Promise<string> => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 15));
      active--;
      return 'ok';
    };
    await Promise.all(Array.from({ length: 8 }, () => s.run(task)));
    expect(peak).toBeLessThanOrEqual(2);
    expect(peak).toBeGreaterThan(0);
  });

  it('retries a rate-limited call with backoff, then succeeds', async () => {
    const s = new CallScheduler({
      maxConcurrency: 4,
      requestsPerMinute: 10000,
      tokensPerMinute: 10_000_000,
      maxRetries: 3,
      baseDelayMs: 2,
    });
    let attempts = 0;
    const result = await s.run(async () => {
      attempts++;
      if (attempts < 3) throw new ProviderError('rate-limited', 'slow down');
      return 'done';
    });
    expect(result).toBe('done');
    expect(attempts).toBe(3);
  });

  it('does not retry a non-rate-limit error', async () => {
    const s = new CallScheduler({
      maxConcurrency: 4,
      requestsPerMinute: 10000,
      tokensPerMinute: 10_000_000,
      maxRetries: 3,
      baseDelayMs: 2,
    });
    let attempts = 0;
    await expect(
      s.run(async () => {
        attempts++;
        throw new ProviderError('auth', 'bad key');
      }),
    ).rejects.toThrow();
    expect(attempts).toBe(1);
  });

  it('gives up after maxRetries on persistent rate limiting', async () => {
    const s = new CallScheduler({
      maxConcurrency: 4,
      requestsPerMinute: 10000,
      tokensPerMinute: 10_000_000,
      maxRetries: 2,
      baseDelayMs: 2,
    });
    let attempts = 0;
    await expect(
      s.run(async () => {
        attempts++;
        throw new ProviderError('rate-limited', 'still throttled');
      }),
    ).rejects.toThrow();
    expect(attempts).toBe(3); // initial + 2 retries
  });
});

describe('WindowLimiter', () => {
  it('admits acquisitions while the rolling-window budget has room', async () => {
    const lim = new WindowLimiter(100, 1000);
    const start = Date.now();
    await lim.acquire(40);
    await lim.acquire(40);
    expect(Date.now() - start).toBeLessThan(50); // both fit in the budget
  });

  it('delays an acquisition that would exceed the window budget', async () => {
    const lim = new WindowLimiter(100, 150); // 150 ms window
    await lim.acquire(80);
    const start = Date.now();
    await lim.acquire(80); // 80 + 80 > 100 → must wait for the window to drain
    expect(Date.now() - start).toBeGreaterThanOrEqual(100);
  });

  it('admits an oversized cost once the window is empty (never deadlocks)', async () => {
    const lim = new WindowLimiter(100, 1000);
    const start = Date.now();
    await lim.acquire(5000); // larger than the whole budget
    expect(Date.now() - start).toBeLessThan(50);
  });
});
