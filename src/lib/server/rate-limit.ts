import "server-only";

interface Bucket {
  count: number;
  resetAt: number;
}

const rateBuckets = new Map<string, Bucket>();

/**
 * Lightweight fixed-window rate limiter per Serverless instance.
 * Returns `{ allowed: true, remaining }` or `{ allowed: false, retryAfterSeconds }`.
 */
export function checkRateLimit(params: {
  key: string;
  limit: number;
  windowMs: number;
}): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
  const now = Date.now();
  const current = rateBuckets.get(params.key);

  if (!current || current.resetAt <= now) {
    rateBuckets.set(params.key, {
      count: 1,
      resetAt: now + params.windowMs,
    });
    return {
      allowed: true,
      remaining: Math.max(0, params.limit - 1),
      retryAfterSeconds: Math.ceil(params.windowMs / 1000),
    };
  }

  if (current.count >= params.limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }

  current.count += 1;
  return {
    allowed: true,
    remaining: Math.max(0, params.limit - current.count),
    retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
  };
}

export function resetRateLimitsForTests() {
  rateBuckets.clear();
}
