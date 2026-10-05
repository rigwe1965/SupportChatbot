import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/rate-limit", async (original) => ({
  ...(await original<typeof import("@/lib/rate-limit")>()),
  rateLimit: vi.fn(),
}));
vi.mock("@/lib/account", () => ({ changePassword: vi.fn() }));

import { POST } from "@/app/api/account/change-password/route";
import { changePassword } from "@/lib/account";
import { getSession } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";

const ok = { allowed: true, limit: 5, remaining: 4, resetSeconds: 60 };
const post = (body: unknown) =>
  POST(new Request("http://localhost/x", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getSession).mockResolvedValue({ user: { id: "u1" } } as never);
  vi.mocked(rateLimit).mockResolvedValue(ok);
  vi.mocked(changePassword).mockResolvedValue({ ok: true });
});

describe("POST /api/account/change-password", () => {
  it("rejects anonymous callers", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await post({})).status).toBe(401);
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("changes the signed-in user's password only, whatever the body names", async () => {
    const res = await post({ userId: "other", currentPassword: "old", newPassword: "new" });
    expect(res.status).toBe(200);
    expect(changePassword).toHaveBeenCalledWith("u1", "old", "new");
  });

  it("returns service errors as 400 without echoing passwords", async () => {
    vi.mocked(changePassword).mockResolvedValue({ error: "Your current password is incorrect" });
    const res = await post({ currentPassword: "SECRET-OLD", newPassword: "SECRET-NEW" });
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).not.toContain("SECRET");
  });

  it("tolerates a non-JSON body", async () => {
    await post("garbage");
    expect(changePassword).toHaveBeenCalledWith("u1", undefined, undefined);
  });

  it("is rate limited per user before checking the password", async () => {
    vi.mocked(rateLimit).mockResolvedValue({ ...ok, allowed: false });
    expect((await post({})).status).toBe(429);
    expect(vi.mocked(rateLimit).mock.calls[0][0]).toBe("change-password:u1");
    expect(changePassword).not.toHaveBeenCalled();
  });
});
