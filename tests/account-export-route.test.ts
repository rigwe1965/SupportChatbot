import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/rate-limit", async (original) => ({
  ...(await original<typeof import("@/lib/rate-limit")>()),
  rateLimit: vi.fn(),
}));
vi.mock("@/lib/account-export", () => ({ exportAccountData: vi.fn() }));

import { POST } from "@/app/api/account/export/route";
import { exportAccountData } from "@/lib/account-export";
import { getSession } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";

const ok = { allowed: true, limit: 5, remaining: 4, resetSeconds: 60 };
const post = (body: unknown) =>
  POST(new Request("http://localhost/api/account/export", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getSession).mockResolvedValue({ user: { id: "u1" } } as never);
  vi.mocked(rateLimit).mockResolvedValue(ok);
  vi.mocked(exportAccountData).mockResolvedValue({ ok: true, data: { profile: { id: "u1" } }, filename: "my-data-2026-10-05.json" });
});

describe("POST /api/account/export", () => {
  it("rejects anonymous callers", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await post({})).status).toBe(401);
    expect(exportAccountData).not.toHaveBeenCalled();
  });

  it("returns the data as a private JSON download", async () => {
    const res = await post({ password: "pw", userId: "someone-else" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="my-data-2026-10-05.json"');
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(JSON.parse(await res.text())).toEqual({ profile: { id: "u1" } });
    // always the signed-in user, never one named in the body
    expect(exportAccountData).toHaveBeenCalledWith("u1", { password: "pw" });
  });

  it("passes service errors through", async () => {
    vi.mocked(exportAccountData).mockResolvedValue({ error: "Your password is incorrect", status: 400 });
    const res = await post({ password: "x" });
    expect(res.status).toBe(400);
    expect(res.headers.get("Content-Disposition")).toBeNull();
  });

  it("tolerates a non-JSON body", async () => {
    await post("garbage");
    expect(exportAccountData).toHaveBeenCalledWith("u1", { password: undefined });
  });

  it("is rate limited per user", async () => {
    vi.mocked(rateLimit).mockResolvedValue({ ...ok, allowed: false });
    expect((await post({})).status).toBe(429);
    expect(vi.mocked(rateLimit).mock.calls[0][0]).toBe("export:u1");
    expect(exportAccountData).not.toHaveBeenCalled();
  });
});
