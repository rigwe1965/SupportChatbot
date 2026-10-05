import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: { $queryRaw: vi.fn(), rateLimit: { deleteMany: vi.fn() } },
}));

import { db } from "@/lib/db";
import { chatRules, rateLimit, rateLimitHeaders, rateLimitResponse } from "@/lib/rate-limit";

const query = vi.mocked(db.$queryRaw);
const purge = vi.mocked(db.rateLimit.deleteMany);

/** Makes the counter for each successive rule return the given values. */
const counts = (...values: number[]) => values.forEach((count) => query.mockResolvedValueOnce([{ count }] as never));

// 2026-01-01T00:00:30Z — 30s into both the minute window and the hour window
const NOW = Date.UTC(2026, 0, 1, 0, 0, 30);
const rules = [
  { name: "minute", limit: 3, windowSeconds: 60 },
  { name: "hour", limit: 10, windowSeconds: 3600 },
];

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(Math, "random").mockReturnValue(0.5); // no cleanup by default
});

describe("rateLimit", () => {
  it("allows requests under the limit and reports the tightest window", async () => {
    counts(1, 4);
    const r = await rateLimit("chat:u1", rules, NOW);
    expect(r).toEqual({ allowed: true, limit: 3, remaining: 2, resetSeconds: 30 });
  });

  it("allows the request that exactly reaches the limit, blocks the next", async () => {
    counts(3, 1);
    expect((await rateLimit("chat:u1", rules, NOW)).allowed).toBe(true);

    query.mockReset();
    counts(4);
    const blocked = await rateLimit("chat:u1", rules, NOW);
    expect(blocked).toMatchObject({ allowed: false, remaining: 0, limit: 3 });
  });

  it("blocks on the hourly rule too and reports that window's reset time", async () => {
    counts(1, 11);
    const r = await rateLimit("chat:u1", rules, NOW);
    expect(r).toMatchObject({ allowed: false, limit: 10, resetSeconds: 3570 });
  });

  it("stops checking further rules once one is exceeded", async () => {
    counts(4);
    await rateLimit("chat:u1", rules, NOW);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("buckets by identifier and rule, aligned to window starts", async () => {
    counts(1, 1);
    await rateLimit("chat:u1", rules, NOW);

    const [[, key1, start1], [, key2, start2]] = query.mock.calls as unknown as [
      [unknown, string, Date],
      [unknown, string, Date],
    ];
    expect(key1).toBe("chat:u1:minute");
    expect(key2).toBe("chat:u1:hour");
    expect(start1.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(start2.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("starts a fresh window when the time moves into the next one", async () => {
    counts(1, 1);
    await rateLimit("chat:u1", rules, NOW + 60_000);
    const start = (query.mock.calls[0] as unknown as [unknown, string, Date])[2];
    expect(start.toISOString()).toBe("2026-01-01T00:01:00.000Z");
  });

  it("increments atomically with a single upsert statement", async () => {
    counts(1, 1);
    await rateLimit("chat:u1", rules, NOW);
    const sql = (query.mock.calls[0][0] as unknown as string[]).join("?");
    expect(sql).toMatch(/INSERT INTO "RateLimit"/);
    expect(sql).toMatch(/ON CONFLICT \("key", "windowStart"\) DO UPDATE/);
    expect(sql).toMatch(/RETURNING "count"/);
  });

  it("fails open when the database errors", async () => {
    query.mockRejectedValue(new Error("db down"));
    const r = await rateLimit("chat:u1", rules, NOW);
    expect(r.allowed).toBe(true);
    expect(rateLimitHeaders(r)).toEqual({}); // no misleading headers
  });

  it("occasionally purges old windows, but not on every call", async () => {
    counts(1, 1);
    await rateLimit("chat:u1", rules, NOW);
    expect(purge).not.toHaveBeenCalled();

    vi.spyOn(Math, "random").mockReturnValue(0.001);
    counts(1, 1);
    await rateLimit("chat:u1", rules, NOW);
    expect(purge).toHaveBeenCalledWith({
      where: { windowStart: { lt: new Date(NOW - 25 * 3600 * 1000) } },
    });
  });

  it("keeps working if the cleanup fails", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.001);
    purge.mockRejectedValue(new Error("nope"));
    counts(1, 1);
    expect((await rateLimit("chat:u1", rules, NOW)).allowed).toBe(true);
  });
});

describe("chatRules", () => {
  it("defaults to 10 per minute and 100 per hour", () => {
    expect(chatRules()).toEqual([
      { name: "minute", limit: 10, windowSeconds: 60 },
      { name: "hour", limit: 100, windowSeconds: 3600 },
    ]);
  });

  it("is configurable via the environment", () => {
    vi.stubEnv("RATE_LIMIT_CHAT_PER_MINUTE", "5");
    vi.stubEnv("RATE_LIMIT_CHAT_PER_HOUR", "50");
    expect(chatRules().map((r) => r.limit)).toEqual([5, 50]);
  });

  it.each(["0", "-3", "abc", ""])("falls back to the default for invalid value %j", (v) => {
    vi.stubEnv("RATE_LIMIT_CHAT_PER_MINUTE", v);
    expect(chatRules()[0].limit).toBe(10);
  });
});

describe("responses", () => {
  const blocked = { allowed: false, limit: 10, remaining: 0, resetSeconds: 42 };

  it("builds a 429 with Retry-After and rate-limit headers", async () => {
    const res = rateLimitResponse(blocked);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
    expect(res.headers.get("X-RateLimit-Limit")).toBe("10");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(res.headers.get("X-RateLimit-Reset")).toBe("42");
    expect((await res.json()).error).toMatch(/too quickly.*42s/);
  });
});
