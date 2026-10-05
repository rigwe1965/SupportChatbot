import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rate-limit", async (original) => ({
  ...(await original<typeof import("@/lib/rate-limit")>()),
  rateLimit: vi.fn(),
}));
vi.mock("@/lib/account", async (original) => ({
  ...(await original<typeof import("@/lib/account")>()),
  registerUser: vi.fn(),
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
  verifyEmail: vi.fn(),
}));

import { POST as forgot } from "@/app/api/account/forgot-password/route";
import { POST as register } from "@/app/api/account/register/route";
import { POST as reset } from "@/app/api/account/reset-password/route";
import { POST as verify } from "@/app/api/account/verify-email/route";
import { registerUser, requestPasswordReset, resetPassword, verifyEmail } from "@/lib/account";
import { rateLimit } from "@/lib/rate-limit";

const limiter = vi.mocked(rateLimit);
const ok = { allowed: true, limit: 5, remaining: 4, resetSeconds: 60 };
const blocked = { allowed: false, limit: 5, remaining: 0, resetSeconds: 120 };

const post = (route: typeof register, body: unknown, ip = "203.0.113.5") =>
  route(
    new Request("http://localhost/x", {
      method: "POST",
      headers: { "x-forwarded-for": ip },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

beforeEach(() => {
  vi.resetAllMocks();
  limiter.mockResolvedValue(ok);
});

describe("POST /api/account/register", () => {
  const body = { name: "Ada", email: "Ada@Example.com", password: "correct horse battery" };
  beforeEach(() => vi.mocked(registerUser).mockResolvedValue({ ok: true }));

  it("returns the same generic success whatever happened to the address", async () => {
    vi.mocked(registerUser).mockResolvedValue({ ok: true });
    const res = await post(register, body);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { ok: true } });
    expect(registerUser).toHaveBeenCalledWith({ name: "Ada", email: "Ada@Example.com", password: body.password });
  });

  it("returns validation errors as 400", async () => {
    vi.mocked(registerUser).mockResolvedValue({ error: "Password must be at least 10 characters" });
    const res = await post(register, body);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/at least 10/);
  });

  it("tolerates a non-JSON body", async () => {
    vi.mocked(registerUser).mockResolvedValue({ error: "Enter a valid email address" });
    expect((await post(register, "not json")).status).toBe(400);
  });

  it("limits sign-ups per IP and per address, before doing any work", async () => {
    await post(register, body, "198.51.100.9");
    expect(limiter.mock.calls.map((c) => c[0])).toEqual(["register:ip:198.51.100.9", "register:email:ada@example.com"]);

    limiter.mockResolvedValueOnce(blocked);
    const res = await post(register, body);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("120");
    expect(registerUser).toHaveBeenCalledTimes(1); // only the first, allowed, call
  });

  it("blocks an address that has been signed up too often (mail-bombing)", async () => {
    limiter.mockResolvedValueOnce(ok).mockResolvedValueOnce(blocked);
    expect((await post(register, body)).status).toBe(429);
    expect(registerUser).not.toHaveBeenCalled();
  });
});

describe("POST /api/account/forgot-password", () => {
  it("responds identically for known and unknown addresses", async () => {
    const known = await post(forgot, { email: "ada@example.com" });
    const unknown = await post(forgot, { email: "ghost@example.com" });
    expect([known.status, unknown.status]).toEqual([200, 200]);
    expect(await known.json()).toEqual(await unknown.json());
    expect(requestPasswordReset).toHaveBeenCalledTimes(2);
  });

  it.each([{}, { email: "nope" }, { email: 5 }, "garbage"])("rejects an invalid address %j", async (body) => {
    const res = await post(forgot, body);
    expect(res.status).toBe(400);
    expect(requestPasswordReset).not.toHaveBeenCalled();
  });

  it("allows only a few requests per IP and per address", async () => {
    await post(forgot, { email: "Ada@Example.com" }, "198.51.100.9");
    expect(limiter.mock.calls.map((c) => [c[0], c[1][0].limit])).toEqual([
      ["forgot:ip:198.51.100.9", 5],
      ["forgot:email:ada@example.com", 3],
    ]);
  });

  it("returns 429 without sending anything once over the limit", async () => {
    limiter.mockResolvedValueOnce(ok).mockResolvedValueOnce(blocked);
    expect((await post(forgot, { email: "ada@example.com" })).status).toBe(429);
    expect(requestPasswordReset).not.toHaveBeenCalled();
  });
});

describe("POST /api/account/reset-password", () => {
  it("sets the password with a valid token", async () => {
    vi.mocked(resetPassword).mockResolvedValue({ ok: true });
    const res = await post(reset, { token: "tok", password: "correct horse battery" });
    expect(res.status).toBe(200);
    expect(resetPassword).toHaveBeenCalledWith("tok", "correct horse battery");
  });

  it("passes service errors (bad link, weak password) back as 400", async () => {
    vi.mocked(resetPassword).mockResolvedValue({ error: "This link is invalid or has expired." });
    const res = await post(reset, { token: "bad", password: "correct horse battery" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/invalid or has expired/);
  });

  it.each([{}, { token: "" }, { token: 5 }, { password: "x" }])("rejects a missing token %j without trying", async (body) => {
    expect((await post(reset, body)).status).toBe(400);
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it("rate limits guessing", async () => {
    limiter.mockResolvedValue(blocked);
    expect((await post(reset, { token: "tok", password: "correct horse battery" })).status).toBe(429);
    expect(resetPassword).not.toHaveBeenCalled();
  });
});

describe("POST /api/account/verify-email", () => {
  it("confirms with a valid token", async () => {
    vi.mocked(verifyEmail).mockResolvedValue({ ok: true });
    expect((await post(verify, { token: "tok" })).status).toBe(200);
    expect(verifyEmail).toHaveBeenCalledWith("tok");
  });

  it("returns 400 for a bad link or missing token", async () => {
    vi.mocked(verifyEmail).mockResolvedValue({ error: "This link is invalid or has expired." });
    expect((await post(verify, { token: "bad" })).status).toBe(400);
    expect((await post(verify, {})).status).toBe(400);
  });

  it("rate limits attempts", async () => {
    limiter.mockResolvedValue(blocked);
    expect((await post(verify, { token: "tok" })).status).toBe(429);
    expect(verifyEmail).not.toHaveBeenCalled();
  });
});

describe("error responses never echo secrets", () => {
  it("doesn't reflect the token or password back", async () => {
    vi.mocked(resetPassword).mockResolvedValue({ error: "This link is invalid or has expired." });
    const text = await (await post(reset, { token: "SECRET-TOKEN", password: "SECRET-PASSWORD" })).text();
    expect(text).not.toContain("SECRET-TOKEN");
    expect(text).not.toContain("SECRET-PASSWORD");
  });
});
