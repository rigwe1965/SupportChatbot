import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { user: { update: vi.fn() } } }));
vi.mock("@/lib/rate-limit", async (original) => ({
  ...(await original<typeof import("@/lib/rate-limit")>()),
  rateLimit: vi.fn(),
}));

import { POST } from "@/app/api/account/sign-out-everywhere/route";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";

const ok = { allowed: true, limit: 10, remaining: 9, resetSeconds: 60 };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getSession).mockResolvedValue({ user: { id: "u1" } } as never);
  vi.mocked(rateLimit).mockResolvedValue(ok);
});

describe("POST /api/account/sign-out-everywhere", () => {
  it("rejects anonymous callers", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await POST()).status).toBe(401);
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("moves the caller's cutoff to now, for that user only", async () => {
    const before = Date.now();
    const res = await POST();
    expect(res.status).toBe(200);
    const arg = vi.mocked(db.user.update).mock.calls[0][0] as { where: object; data: { sessionsValidFrom: Date } };
    expect(arg.where).toEqual({ id: "u1" });
    expect(arg.data.sessionsValidFrom.getTime()).toBeGreaterThanOrEqual(before);
    expect(arg.data.sessionsValidFrom.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("is rate limited per user", async () => {
    vi.mocked(rateLimit).mockResolvedValue({ ...ok, allowed: false });
    expect((await POST()).status).toBe(429);
    expect(vi.mocked(rateLimit).mock.calls[0][0]).toBe("sign-out-everywhere:u1");
    expect(db.user.update).not.toHaveBeenCalled();
  });
});
