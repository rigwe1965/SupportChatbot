import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export interface RateLimitRule {
  /** Short label, used in logs. */
  name: string;
  limit: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** The limit of the rule that is closest to (or past) being exhausted. */
  limit: number;
  remaining: number;
  /** Seconds until that rule's window resets. */
  resetSeconds: number;
}

const positiveInt = (v: string | undefined, fallback: number) => {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** Per-user limits for the chat endpoints. Read at call time so they can be tuned via env vars. */
export function chatRules(): RateLimitRule[] {
  return [
    { name: "minute", limit: positiveInt(process.env.RATE_LIMIT_CHAT_PER_MINUTE, 10), windowSeconds: 60 },
    { name: "hour", limit: positiveInt(process.env.RATE_LIMIT_CHAT_PER_HOUR, 100), windowSeconds: 3600 },
  ];
}

/**
 * Fixed-window rate limiter backed by Postgres, so it works across serverless instances
 * without extra infrastructure. Each rule is one atomic upsert-and-increment.
 *
 * Fails open: if the database call fails, the request is allowed (and the error logged),
 * because the chat itself needs the same database.
 */
export async function rateLimit(
  identifier: string,
  rules: RateLimitRule[],
  now: number = Date.now(),
): Promise<RateLimitResult> {
  let tightest: RateLimitResult | null = null;

  try {
    for (const rule of rules) {
      const windowMs = rule.windowSeconds * 1000;
      const windowStart = new Date(Math.floor(now / windowMs) * windowMs);
      const key = `${identifier}:${rule.name}`;

      const rows = await db.$queryRaw<{ count: number }[]>`
        INSERT INTO "RateLimit" ("key", "windowStart", "count")
        VALUES (${key}, ${windowStart}, 1)
        ON CONFLICT ("key", "windowStart") DO UPDATE SET "count" = "RateLimit"."count" + 1
        RETURNING "count"`;

      const count = Number(rows[0].count);
      const result: RateLimitResult = {
        allowed: count <= rule.limit,
        limit: rule.limit,
        remaining: Math.max(0, rule.limit - count),
        resetSeconds: Math.max(1, Math.ceil((windowStart.getTime() + windowMs - now) / 1000)),
      };

      // Stop at the first exceeded rule; otherwise report the rule with the least headroom.
      if (!result.allowed) return result;
      if (!tightest || result.remaining < tightest.remaining) tightest = result;
    }

    // Occasionally purge old windows so the table stays small.
    if (Math.random() < 0.01) {
      await db.rateLimit.deleteMany({ where: { windowStart: { lt: new Date(now - 25 * 3600 * 1000) } } });
    }
  } catch (err) {
    console.error("rate limiter failed, allowing request", err);
    return { allowed: true, limit: 0, remaining: 0, resetSeconds: 0 };
  }

  return tightest ?? { allowed: true, limit: 0, remaining: 0, resetSeconds: 0 };
}

export function rateLimitHeaders(r: RateLimitResult): Record<string, string> {
  if (r.limit === 0) return {}; // limiter was unavailable
  return {
    "X-RateLimit-Limit": String(r.limit),
    "X-RateLimit-Remaining": String(r.remaining),
    "X-RateLimit-Reset": String(r.resetSeconds),
  };
}

export function rateLimitResponse(r: RateLimitResult) {
  return NextResponse.json(
    { error: `You're sending messages too quickly. Please try again in ${r.resetSeconds}s.` },
    { status: 429, headers: { ...rateLimitHeaders(r), "Retry-After": String(r.resetSeconds) } },
  );
}
