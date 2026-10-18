import { db } from "./db";

export type RateLimitResult = { allowed: boolean; remaining: number; resetAt: Date };

/**
 * Fixed-window counter stored in Postgres, so it is shared by every web
 * instance. One atomic upsert per call.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  const rows = await db.$queryRaw<{ count: number; resetAt: Date }[]>`
    INSERT INTO rate_limit_buckets (key, count, "resetAt")
    VALUES (${key}, 1, now() + make_interval(secs => ${windowSeconds}))
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limit_buckets."resetAt" <= now() THEN 1 ELSE rate_limit_buckets.count + 1 END,
      "resetAt" = CASE WHEN rate_limit_buckets."resetAt" <= now()
                       THEN now() + make_interval(secs => ${windowSeconds})
                       ELSE rate_limit_buckets."resetAt" END
    RETURNING count, "resetAt"`;
  const { count, resetAt } = rows[0];
  return { allowed: count <= limit, remaining: Math.max(0, limit - count), resetAt };
}

export async function purgeExpiredRateLimits() {
  await db.rateLimitBucket.deleteMany({ where: { resetAt: { lt: new Date(Date.now() - 3600_000) } } });
}
