import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/rate-limit", async (original) => ({
  ...(await original<typeof import("@/lib/rate-limit")>()),
  rateLimit: vi.fn(),
}));
vi.mock("@/lib/account-deletion", () => ({ deleteAccount: vi.fn() }));

import { POST } from "@/app/api/account/delete/route";
import { deleteAccount } from "@/lib/account-deletion";
import { getSession } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";

const ok = { allowed: true, limit: 5, remaining: 4, resetSeconds: 60 };
const post = (body: unknown) =>
  POST(new Request("http://localhost/api/account/delete", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getSession).mockResolvedValue({ user: { id: "u1" } } as never);
  vi.mocked(rateLimit).mockResolvedValue(ok);
  vi.mocked(deleteAccount).mockResolvedValue({ ok: true });
});

describe("POST /api/account/delete", () => {
  it("rejects anonymous callers", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await post({ confirm: "DELETE" })).status).toBe(401);
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it("only ever deletes the signed-in user, whatever the body says", async () => {
    const res = await post({ userId: "someone-else", id: "someone-else", password: "pw", confirm: "DELETE" });
    expect(res.status).toBe(200);
    expect(deleteAccount).toHaveBeenCalledWith("u1", { password: "pw", confirm: "DELETE" }, expect.any(Request));
  });

  it("passes service errors through with their status", async () => {
    vi.mocked(deleteAccount).mockResolvedValue({ error: "Your password is incorrect", status: 400 });
    const res = await post({ password: "x", confirm: "DELETE" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/incorrect/);
  });

  it("tolerates a non-JSON body", async () => {
    vi.mocked(deleteAccount).mockResolvedValue({ error: "Type DELETE to confirm", status: 400 });
    expect((await post("garbage")).status).toBe(400);
  });

  it("rate limits attempts per user before checking anything", async () => {
    vi.mocked(rateLimit).mockResolvedValue({ ...ok, allowed: false });
    expect((await post({ password: "x", confirm: "DELETE" })).status).toBe(429);
    expect(vi.mocked(rateLimit).mock.calls[0][0]).toBe("delete:u1");
    expect(deleteAccount).not.toHaveBeenCalled();
  });
});
