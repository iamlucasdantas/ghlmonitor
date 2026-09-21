/**
 * In-process token bucket. The collector runs behind a load balancer, so this is a
 * cheap first line of defence per instance (§12 "rate limit por IP no coletor");
 * anything heavier belongs at the edge.
 */
interface Bucket { tokens: number; updatedAt: number }

export class RateLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
  ) {}

  take(key: string, cost = 1): boolean {
    const now = Date.now();
    const b = this.buckets.get(key) ?? { tokens: this.capacity, updatedAt: now };
    const elapsed = (now - b.updatedAt) / 1000;
    b.tokens = Math.min(this.capacity, b.tokens + elapsed * this.refillPerSecond);
    b.updatedAt = now;
    if (b.tokens < cost) {
      this.buckets.set(key, b);
      return false;
    }
    b.tokens -= cost;
    this.buckets.set(key, b);
    return true;
  }

  /** Called on a timer so a long-running instance doesn't accumulate dead keys. */
  sweep(maxIdleMs = 600_000): void {
    const cutoff = Date.now() - maxIdleMs;
    for (const [k, b] of this.buckets) if (b.updatedAt < cutoff) this.buckets.delete(k);
  }

  get size(): number {
    return this.buckets.size;
  }
}
