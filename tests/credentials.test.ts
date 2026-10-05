import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: { user: { findUnique: vi.fn() } } }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn() }));
// Real hashing, but spy on the timing-equalising call.
vi.mock("@/lib/password", async (original) => ({
  ...(await original<typeof import("@/lib/password")>()),
  verifyAgainstDummy: vi.fn(),
}));

import { authorizeCredentials } from "@/lib/credentials";
import { db } from "@/lib/db";
import { hashPassword, verifyAgainstDummy } from "@/lib/password";
import { rateLimit } from "@/lib/rate-limit";

const findUser = vi.mocked(db.user.findUnique);
const limiter = vi.mocked(rateLimit);
const dummy = vi.mocked(verifyAgainstDummy);

const PASSWORD = "correct horse battery";
let hash: string;
beforeAll(async () => {
  hash = await hashPassword(PASSWORD);
});

const account = (over = {}) => ({
  id: "u1",
  name: "Ada",
  email: "ada@example.com",
  image: null,
  role: "FREE",
  passwordHash: hash,
  emailVerified: new Date("2026-01-01T00:00:00Z"),
  ...over,
});

const ok = { allowed: true, limit: 10, remaining: 9, resetSeconds: 60 };

beforeEach(() => {
  vi.resetAllMocks();
  limiter.mockResolvedValue(ok);
  findUser.mockResolvedValue(account() as never);
});

describe("authorizeCredentials", () => {
  it("signs in a confirmed account with the right password", async () => {
    const result = await authorizeCredentials({ email: "ada@example.com", password: PASSWORD }, "203.0.113.5");
    expect(result).toEqual({
      id: "u1",
      name: "Ada",
      email: "ada@example.com",
      image: null,
      role: "FREE",
      emailVerified: expect.any(Date),
    });
  });

  it("never returns the password hash", async () => {
    const result = await authorizeCredentials({ email: "ada@example.com", password: PASSWORD }, null);
    expect(JSON.stringify(result)).not.toContain("scrypt$");
    expect(result).not.toHaveProperty("passwordHash");
  });

  it("matches the email case-insensitively", async () => {
    await authorizeCredentials({ email: "  ADA@Example.com ", password: PASSWORD }, null);
    expect(findUser).toHaveBeenCalledWith({ where: { email: "ada@example.com" } });
  });

  it("carries the admin role through", async () => {
    findUser.mockResolvedValue(account({ role: "ADMIN" }) as never);
    expect((await authorizeCredentials({ email: "ada@example.com", password: PASSWORD }, null))?.role).toBe("ADMIN");
  });

  describe("wrong credentials", () => {
    it("returns null for a wrong password", async () => {
      expect(await authorizeCredentials({ email: "ada@example.com", password: "wrong password!" }, null)).toBeNull();
    });

    it("returns null for an unknown email, and still does the same amount of hashing work", async () => {
      findUser.mockResolvedValue(null);
      expect(await authorizeCredentials({ email: "ghost@example.com", password: PASSWORD }, null)).toBeNull();
      expect(dummy).toHaveBeenCalledWith(PASSWORD);
    });

    it("returns null for a Google/GitHub-only account (no password set)", async () => {
      findUser.mockResolvedValue(account({ passwordHash: null }) as never);
      expect(await authorizeCredentials({ email: "ada@example.com", password: PASSWORD }, null)).toBeNull();
      expect(dummy).toHaveBeenCalled();
    });

    it.each([
      [undefined],
      [{}],
      [{ email: "ada@example.com" }],
      [{ password: PASSWORD }],
      [{ email: "not-an-email", password: PASSWORD }],
      [{ email: "ada@example.com", password: "" }],
      [{ email: "ada@example.com", password: "x".repeat(129) }],
    ])("returns null for malformed input %j without any lookups", async (credentials) => {
      expect(await authorizeCredentials(credentials as never, null)).toBeNull();
      expect(findUser).not.toHaveBeenCalled();
      expect(limiter).not.toHaveBeenCalled();
    });
  });

  describe("unconfirmed email", () => {
    beforeEach(() => findUser.mockResolvedValue(account({ emailVerified: null }) as never));

    it("refuses to sign in even with the right password, and says why", async () => {
      await expect(authorizeCredentials({ email: "ada@example.com", password: PASSWORD }, null)).rejects.toThrow(
        "EmailNotVerified",
      );
    });

    it("doesn't reveal that the account is unconfirmed unless the password was right", async () => {
      expect(await authorizeCredentials({ email: "ada@example.com", password: "wrong password!" }, null)).toBeNull();
    });
  });

  describe("rate limiting", () => {
    it("counts attempts per email and per IP", async () => {
      await authorizeCredentials({ email: "Ada@Example.com", password: PASSWORD }, "203.0.113.5");
      expect(limiter.mock.calls.map((c) => c[0]).sort()).toEqual([
        "login:email:ada@example.com",
        "login:ip:203.0.113.5",
      ]);
    });

    it("uses a shared bucket when the IP is unknown", async () => {
      await authorizeCredentials({ email: "ada@example.com", password: PASSWORD }, null);
      expect(limiter.mock.calls.map((c) => c[0])).toContain("login:ip:unknown");
    });

    it("blocks, before looking up the account, after too many attempts for one email", async () => {
      limiter.mockImplementation((async (key: string) =>
        key.startsWith("login:email:") ? { ...ok, allowed: false } : ok) as never);
      await expect(authorizeCredentials({ email: "ada@example.com", password: PASSWORD }, null)).rejects.toThrow(
        "RateLimited",
      );
      expect(findUser).not.toHaveBeenCalled();
    });

    it("blocks after too many attempts from one IP", async () => {
      limiter.mockImplementation((async (key: string) =>
        key.startsWith("login:ip:") ? { ...ok, allowed: false } : ok) as never);
      await expect(authorizeCredentials({ email: "ada@example.com", password: PASSWORD }, "1.2.3.4")).rejects.toThrow(
        "RateLimited",
      );
    });

    it("allows 10 attempts per 15 minutes per email and 30 per IP", async () => {
      await authorizeCredentials({ email: "ada@example.com", password: PASSWORD }, "1.2.3.4");
      const byKey = Object.fromEntries(limiter.mock.calls.map((c) => [c[0], c[1][0]]));
      expect(byKey["login:email:ada@example.com"]).toMatchObject({ limit: 10, windowSeconds: 900 });
      expect(byKey["login:ip:1.2.3.4"]).toMatchObject({ limit: 30, windowSeconds: 900 });
    });
  });
});
