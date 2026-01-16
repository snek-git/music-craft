import type { Context, Next } from "hono";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const stores = new Map<string, Map<string, RateLimitEntry>>();

interface RateLimitOptions {
  windowMs: number; // Time window in milliseconds
  max: number; // Max requests per window
  keyGenerator?: (c: Context) => string;
  name?: string; // Unique name for this limiter
}

export function rateLimit(options: RateLimitOptions) {
  const {
    windowMs,
    max,
    keyGenerator = (c) => c.req.header("x-forwarded-for") || "unknown",
    name = "default",
  } = options;

  // Get or create store for this limiter
  if (!stores.has(name)) {
    stores.set(name, new Map());
  }
  const store = stores.get(name)!;

  // Cleanup old entries periodically
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.resetAt < now) {
        store.delete(key);
      }
    }
  }, windowMs);

  return async (c: Context, next: Next) => {
    const key = keyGenerator(c);
    const now = Date.now();
    const entry = store.get(key);

    if (!entry || entry.resetAt < now) {
      // New window
      store.set(key, { count: 1, resetAt: now + windowMs });
      await next();
      return;
    }

    if (entry.count >= max) {
      // Rate limit exceeded
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      c.header("Retry-After", retryAfter.toString());
      c.header("X-RateLimit-Limit", max.toString());
      c.header("X-RateLimit-Remaining", "0");
      c.header("X-RateLimit-Reset", Math.ceil(entry.resetAt / 1000).toString());
      return c.json({ error: "Too many requests, please try again later" }, 429);
    }

    // Increment count
    entry.count++;
    c.header("X-RateLimit-Limit", max.toString());
    c.header("X-RateLimit-Remaining", (max - entry.count).toString());
    c.header("X-RateLimit-Reset", Math.ceil(entry.resetAt / 1000).toString());

    await next();
  };
}

// Pre-configured limiters for different endpoints
export const generalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  name: "general",
});

export const combineLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 combinations per minute (LLM calls are expensive)
  name: "combine",
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 auth attempts per 15 minutes
  name: "auth",
});

export const spotifyLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 Spotify API calls per minute
  name: "spotify",
});
