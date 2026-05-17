// src/document/scheduler.ts
// Bounded-concurrency call scheduler for LLM requests:
//   * a concurrency semaphore,
//   * a sliding-window requests-per-minute limiter,
//   * a sliding-window TOKENS-per-minute limiter — the binding constraint on
//     most free tiers, since batched requests are large,
//   * exponential backoff with jitter as the safety net when a 429 still slips
//     through.

import { ProviderError } from './types.js';

export interface SchedulerOptions {
  /** Max requests in flight at once. */
  maxConcurrency: number;
  /** Soft cap on requests started per rolling 60 s window. */
  requestsPerMinute: number;
  /** Soft cap on (estimated) tokens started per rolling 60 s window. */
  tokensPerMinute: number;
  /** Backoff retries when a call still comes back rate-limited. */
  maxRetries: number;
  /** Base backoff delay in ms (doubles per attempt, plus jitter). */
  baseDelayMs: number;
}

// `tokensPerMinute` defaults high — the managed backend / Ollama / paid tiers
// have generous limits, and throttling the common case would make small runs
// needlessly slow. Constrained free tiers (e.g. Groq free) set a low value in
// `.refactronrc.json` to opt into token pacing.
export const DEFAULT_SCHEDULER: SchedulerOptions = {
  maxConcurrency: 4,
  requestsPerMinute: 25,
  tokensPerMinute: 200_000,
  maxRetries: 4,
  baseDelayMs: 800,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Concurrency semaphore. */
class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active++;
  }

  release(): void {
    this.active--;
    const next = this.waiters.shift();
    if (next) next();
  }
}

/**
 * Sliding-window limiter over a per-window budget. Each acquisition has a
 * `cost` (1 for a request limiter, the estimated token count for a token
 * limiter); it waits until the rolling-window sum has room. A single cost
 * larger than the whole budget is admitted once the window drains (best
 * effort — never deadlock). `windowMs` is injectable for testing.
 */
export class WindowLimiter {
  private readonly events: Array<{ at: number; cost: number }> = [];

  constructor(
    private readonly budget: number,
    private readonly windowMs: number = 60_000,
  ) {}

  private windowCost(now: number): number {
    while (this.events.length > 0 && now - this.events[0]!.at >= this.windowMs) {
      this.events.shift();
    }
    return this.events.reduce((sum, e) => sum + e.cost, 0);
  }

  async acquire(cost: number): Promise<void> {
    for (;;) {
      const now = Date.now();
      const used = this.windowCost(now);
      if (used + cost <= this.budget || used === 0) {
        this.events.push({ at: now, cost });
        return;
      }
      // Wait for the oldest event to age out of the window.
      await sleep(this.windowMs - (now - this.events[0]!.at) + 20);
    }
  }
}

/**
 * Routes every provider call through concurrency + request/token rate limits +
 * backoff. A `rate-limited` ProviderError is retried with exponential backoff
 * + jitter; any other error propagates immediately.
 */
export class CallScheduler {
  private readonly sem: Semaphore;
  private readonly reqLimiter: WindowLimiter;
  private readonly tokenLimiter: WindowLimiter;

  constructor(private readonly opts: SchedulerOptions = DEFAULT_SCHEDULER) {
    this.sem = new Semaphore(Math.max(1, opts.maxConcurrency));
    this.reqLimiter = new WindowLimiter(Math.max(1, opts.requestsPerMinute));
    this.tokenLimiter = new WindowLimiter(Math.max(1, opts.tokensPerMinute));
  }

  /**
   * Run `fn` under the scheduler. `estimatedTokens` is the call's rough token
   * cost (prompt + completion) — used to pace against the tokens-per-minute
   * budget, the limit batched requests actually hit.
   */
  async run<T>(fn: () => Promise<T>, estimatedTokens = 0): Promise<T> {
    await this.sem.acquire();
    try {
      // Pace ONCE per call — not per retry. Re-pacing inside the retry loop
      // makes a persistently rate-limited call wait the full token window on
      // every attempt (minutes per call); retries should only back off.
      await this.reqLimiter.acquire(1);
      await this.tokenLimiter.acquire(estimatedTokens);
      for (let attempt = 0; ; attempt++) {
        try {
          return await fn();
        } catch (err) {
          const rateLimited = err instanceof ProviderError && err.kind === 'rate-limited';
          if (!rateLimited || attempt >= this.opts.maxRetries) throw err;
          const backoff = this.opts.baseDelayMs * 2 ** attempt;
          await sleep(backoff + Math.random() * this.opts.baseDelayMs);
        }
      }
    } finally {
      this.sem.release();
    }
  }
}
