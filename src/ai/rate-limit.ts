/**
 * Fixed-window, in-memory rate limiter. Good enough for a single instance POC;
 * a multi-instance deployment needs a shared store (e.g. Redis) instead.
 */
export function createRateLimiter({ limit, windowMs }: { limit: number; windowMs: number }) {
  const windows = new Map<string, { start: number; count: number }>();

  return {
    /** Records a hit; returns how long to wait (ms) if over the limit, else 0. */
    hit(key: string, now = Date.now()): number {
      if (windows.size > 10_000) {
        for (const [k, w] of windows) if (now - w.start >= windowMs) windows.delete(k);
      }
      const current = windows.get(key);
      if (!current || now - current.start >= windowMs) {
        windows.set(key, { start: now, count: 1 });
        return 0;
      }
      current.count += 1;
      return current.count > limit ? current.start + windowMs - now : 0;
    },
  };
}

export type RateLimiter = ReturnType<typeof createRateLimiter>;

/** Best-effort client key: first forwarded address (set by the hosting proxy). */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "local";
}
