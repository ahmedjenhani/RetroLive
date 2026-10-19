export interface HitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * Sliding-window limiter kept in memory: "at most `limit` hits per `windowMs` for each key".
 * Fine for a single server instance, which is what this app runs as.
 */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  hit(key: string): HitResult {
    const now = this.now();
    const cutoff = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > cutoff);

    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      const oldest = recent[0] ?? now;
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000)) };
    }

    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 5000) {
      this.sweep(cutoff);
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }

  forget(key: string): void {
    this.hits.delete(key);
  }

  private sweep(cutoff: number): void {
    for (const [key, times] of this.hits) {
      if (times.every((t) => t <= cutoff)) {
        this.hits.delete(key);
      }
    }
  }
}
