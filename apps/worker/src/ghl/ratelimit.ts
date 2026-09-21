/**
 * HighLevel allows 100 requests per 10 s per location (PRD §6.2). One limiter per
 * location id keeps a 500-sub-account sync from tripping a burst limit that is
 * scoped to a single sub-account anyway.
 */
export class SlidingWindowLimiter {
  private hits: number[] = [];

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  async acquire(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.hits = this.hits.filter((t) => now - t < this.windowMs);
      if (this.hits.length < this.limit) {
        this.hits.push(now);
        return;
      }
      const oldest = this.hits[0]!;
      await sleep(this.windowMs - (now - oldest) + 25);
    }
  }
}

const limiters = new Map<string, SlidingWindowLimiter>();

export function limiterFor(key: string): SlidingWindowLimiter {
  let l = limiters.get(key);
  if (!l) {
    l = new SlidingWindowLimiter(100, 10_000);
    limiters.set(key, l);
  }
  return l;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
