import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => {
  const db = {
    user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    authToken: { deleteMany: vi.fn() },
    $transaction: vi.fn(),
  };
  return { db };
});
vi.mock("@/lib/auth-tokens", () => ({ createToken: vi.fn(), consumeToken: vi.fn() }));
vi.mock("@/lib/account-email", async (original) => ({
  ...(await original<typeof import("@/lib/account-email")>()),
  sendAccountEmail: vi.fn(),
}));
// Hashing is covered in password.test.ts; keep these tests fast.
vi.mock("@/lib/password", async (original) => ({
  ...(await original<typeof import("@/lib/password")>()),
  hashPassword: vi.fn(async (p: string) => `hashed(${p})`),
}));

import { sendAccountEmail } from "@/lib/account-email";
import { changePassword, normalizeEmail, registerUser, requestPasswordReset, resetPassword, verifyEmail } from "@/lib/account";
import { consumeToken, createToken } from "@/lib/auth-tokens";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/password";

const user = vi.mocked(db.user);
const send = vi.mocked(sendAccountEmail);
const newToken = vi.mocked(createToken);
const useToken = vi.mocked(consumeToken);

const GOOD = "correct horse battery";
const sentTo = () => send.mock.calls.map((c) => c[0]);
const sentSubject = (i = 0) => send.mock.calls[i][1].subject;
const sentText = (i = 0) => send.mock.calls[i][1].text;
const createdData = (i: number) => (user.create.mock.calls[i][0] as { data: Record<string, unknown> }).data;

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXTAUTH_URL", "https://support.example.com");
  vi.mocked(db.$transaction).mockImplementation((async (fn: (tx: typeof db) => unknown) => fn(db)) as never);
  newToken.mockResolvedValue("tok_abc");
  send.mockResolvedValue(true);
  user.create.mockImplementation((async ({ data }: { data: object }) => ({ id: "u-new", ...data })) as never);
  user.update.mockResolvedValue({} as never);
  // resetAllMocks wipes the factory's implementation, so set it again.
  vi.mocked(hashPassword).mockImplementation(async (p: string) => `hashed(${p})`);
});

describe("normalizeEmail", () => {
  it("trims and lower-cases", () => expect(normalizeEmail("  Ada@Example.COM ")).toBe("ada@example.com"));
  it.each(["", "nope", "a@b", "a b@c.com", "<x>@y.com", "a@b.c om", 5, null, undefined, `${"a".repeat(250)}@x.com`])(
    "rejects %j",
    (v) => expect(normalizeEmail(v)).toBeNull(),
  );
});

describe("registerUser", () => {
  it("rejects a bad email or weak password before touching the database or sending anything", async () => {
    expect(await registerUser({ email: "nope", password: GOOD })).toEqual({ error: expect.stringMatching(/email/i) });
    expect(await registerUser({ email: "a@b.com", password: "short" })).toEqual({
      error: expect.stringMatching(/at least 10/),
    });
    expect(user.findUnique).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("creates an unconfirmed account and emails a confirmation link", async () => {
    user.findUnique.mockResolvedValue(null);
    expect(await registerUser({ name: "  Ada  ", email: " Ada@Example.com ", password: GOOD })).toEqual({ ok: true });

    expect(user.create).toHaveBeenCalledWith({
      data: { email: "ada@example.com", name: "Ada", passwordHash: `hashed(${GOOD})` },
    });
    // not confirmed: no emailVerified is set at creation
    expect(createdData(0)).not.toHaveProperty("emailVerified");
    expect(newToken).toHaveBeenCalledWith("u-new", "VERIFY_EMAIL");
    expect(sentTo()).toEqual(["ada@example.com"]);
    expect(sentText()).toContain("https://support.example.com/verify-email?token=tok_abc");
  });

  it("never stores the plain password", async () => {
    user.findUnique.mockResolvedValue(null);
    await registerUser({ email: "a@b.com", password: GOOD });
    expect(JSON.stringify(user.create.mock.calls)).not.toContain(`"${GOOD}"`);
  });

  it("limits and cleans the name", async () => {
    user.findUnique.mockResolvedValue(null);
    await registerUser({ name: "x".repeat(300), email: "a@b.com", password: GOOD });
    expect(createdData(0).name).toHaveLength(100);

    await registerUser({ name: "   ", email: "c@d.com", password: GOOD });
    expect(createdData(1).name).toBeNull();
  });

  describe("when the address already has an account", () => {
    it("leaves a confirmed password account completely alone and says so by email", async () => {
      user.findUnique.mockResolvedValue({ id: "u1", email: "a@b.com", passwordHash: "old", emailVerified: new Date() } as never);

      expect(await registerUser({ email: "a@b.com", password: GOOD })).toEqual({ ok: true });
      expect(user.create).not.toHaveBeenCalled();
      expect(user.update).not.toHaveBeenCalled();
      expect(newToken).not.toHaveBeenCalled();
      expect(sentSubject()).toMatch(/already have an account/i);
    });

    it("never attaches a password to a Google/GitHub account (no takeover by knowing the email)", async () => {
      user.findUnique.mockResolvedValue({ id: "u1", email: "a@b.com", passwordHash: null, emailVerified: null } as never);

      await registerUser({ email: "a@b.com", password: GOOD });
      expect(user.update).not.toHaveBeenCalled();
      expect(newToken).not.toHaveBeenCalled();
      expect(sentSubject()).toMatch(/already have an account/i);
    });

    it("lets a newer signup replace an unconfirmed one, so squatting on an address doesn't work", async () => {
      user.findUnique.mockResolvedValue({ id: "u1", email: "a@b.com", name: "Old", passwordHash: "attacker", emailVerified: null } as never);

      await registerUser({ name: "Real Owner", email: "a@b.com", password: GOOD });
      expect(user.update).toHaveBeenCalledWith({
        where: { id: "u1" },
        data: { passwordHash: `hashed(${GOOD})`, name: "Real Owner" },
      });
      expect(newToken).toHaveBeenCalledWith("u1", "VERIFY_EMAIL");
      expect(sentSubject()).toMatch(/confirm/i);
    });

    it("returns exactly the same result in every case", async () => {
      const results = [];
      for (const existing of [
        null,
        { id: "1", passwordHash: "h", emailVerified: new Date() },
        { id: "2", passwordHash: null, emailVerified: null },
        { id: "3", passwordHash: "h", emailVerified: null },
      ]) {
        user.findUnique.mockResolvedValue(existing as never);
        results.push(await registerUser({ email: "a@b.com", password: GOOD }));
      }
      expect(new Set(results.map((r) => JSON.stringify(r)))).toEqual(new Set(['{"ok":true}']));
    });
  });
});

describe("verifyEmail", () => {
  it("marks the address confirmed", async () => {
    useToken.mockResolvedValue({ userId: "u1" });
    expect(await verifyEmail("tok")).toEqual({ ok: true });
    expect(useToken).toHaveBeenCalledWith("tok", "VERIFY_EMAIL", expect.anything());
    expect(user.update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { emailVerified: expect.any(Date) } });
  });

  it("rejects a bad link without changing anything", async () => {
    useToken.mockResolvedValue(null);
    expect(await verifyEmail("bad")).toEqual({ error: expect.stringMatching(/invalid or has expired/) });
    expect(user.update).not.toHaveBeenCalled();
  });
});

describe("requestPasswordReset", () => {
  it("emails a reset link to a known address (case-insensitively)", async () => {
    user.findUnique.mockResolvedValue({ id: "u1" } as never);
    await requestPasswordReset("Ada@Example.com");

    expect(user.findUnique).toHaveBeenCalledWith({ where: { email: "ada@example.com" }, select: { id: true } });
    expect(newToken).toHaveBeenCalledWith("u1", "RESET_PASSWORD");
    expect(sentTo()).toEqual(["ada@example.com"]);
    expect(sentText()).toContain("https://support.example.com/reset-password?token=tok_abc");
  });

  it("does nothing, silently, for an unknown address", async () => {
    user.findUnique.mockResolvedValue(null);
    await expect(requestPasswordReset("ghost@example.com")).resolves.toBeUndefined();
    expect(newToken).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("ignores things that aren't email addresses", async () => {
    await requestPasswordReset("not an email");
    await requestPasswordReset(undefined);
    expect(user.findUnique).not.toHaveBeenCalled();
  });
});

describe("resetPassword", () => {
  beforeEach(() => {
    useToken.mockResolvedValue({ userId: "u1" });
    user.findUnique.mockResolvedValue({ email: "ada@example.com", emailVerified: null } as never);
    vi.mocked(db.authToken.deleteMany).mockResolvedValue({ count: 2 } as never);
  });

  it("sets the new password, confirms the address, voids other links and notifies the owner", async () => {
    expect(await resetPassword("tok", GOOD)).toEqual({ ok: true });

    expect(useToken).toHaveBeenCalledWith("tok", "RESET_PASSWORD", expect.anything());
    expect(user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { passwordHash: `hashed(${GOOD})`, emailVerified: expect.any(Date) },
    });
    expect(db.authToken.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
    expect(sentTo()).toEqual(["ada@example.com"]);
    expect(sentSubject()).toMatch(/password was changed/i);
  });

  it("keeps the original confirmation date for an already-confirmed address", async () => {
    const confirmedAt = new Date("2025-01-01T00:00:00Z");
    user.findUnique.mockResolvedValue({ email: "ada@example.com", emailVerified: confirmedAt } as never);
    await resetPassword("tok", GOOD);
    expect(user.update.mock.calls[0][0].data.emailVerified).toBe(confirmedAt);
  });

  it("rejects a weak password WITHOUT using up the link, so the person can try again", async () => {
    expect(await resetPassword("tok", "short")).toEqual({ error: expect.stringMatching(/at least 10/) });
    expect(useToken).not.toHaveBeenCalled();
    expect(user.update).not.toHaveBeenCalled();
  });

  it("rejects an invalid, expired or used link: nothing changes and nobody is emailed", async () => {
    useToken.mockResolvedValue(null);
    expect(await resetPassword("bad", GOOD)).toEqual({ error: expect.stringMatching(/invalid or has expired/) });
    expect(user.update).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects a link whose account no longer exists", async () => {
    user.findUnique.mockResolvedValue(null);
    expect(await resetPassword("tok", GOOD)).toEqual({ error: expect.stringMatching(/invalid or has expired/) });
    expect(user.update).not.toHaveBeenCalled();
  });

  it("works for Google/GitHub accounts, which is how they add a password", async () => {
    user.findUnique.mockResolvedValue({ email: "oauth@example.com", emailVerified: new Date() } as never);
    expect(await resetPassword("tok", GOOD)).toEqual({ ok: true });
    expect(user.update.mock.calls[0][0].data.passwordHash).toBe(`hashed(${GOOD})`);
  });

  it("never stores or emails the new password", async () => {
    await resetPassword("tok", GOOD);
    expect(JSON.stringify(user.update.mock.calls)).not.toContain(`"${GOOD}"`);
    expect(sentText()).not.toContain(GOOD);
  });
});

describe("changePassword", () => {
  const OLD = "old password value";
  let oldHash: string;
  beforeEach(async () => {
    const { hashPassword: real } = await vi.importActual<typeof import("@/lib/password")>("@/lib/password");
    oldHash ??= await real(OLD);
    user.findUnique.mockResolvedValue({ email: "ada@example.com", passwordHash: oldHash } as never);
    vi.mocked(db.authToken.deleteMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(db.$transaction).mockImplementation((async (ops: unknown[]) => ops) as never);
  });

  it("sets the new password, voids outstanding links and notifies the owner", async () => {
    expect(await changePassword("u1", OLD, GOOD)).toEqual({ ok: true });
    expect(user.update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { passwordHash: `hashed(${GOOD})` } });
    expect(db.authToken.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
    expect(sentTo()).toEqual(["ada@example.com"]);
    expect(sentSubject()).toMatch(/password was changed/i);
    expect(sentText()).not.toContain(GOOD);
  });

  it.each(["wrong password!", "", undefined, 5])("refuses the wrong current password %j", async (current) => {
    expect(await changePassword("u1", current, GOOD)).toEqual({ error: expect.stringMatching(/current password/) });
    expect(user.update).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects a weak or unchanged new password", async () => {
    expect(await changePassword("u1", OLD, "short")).toEqual({ error: expect.stringMatching(/at least 10/) });
    expect(await changePassword("u1", OLD, OLD)).toEqual({ error: expect.stringMatching(/different/) });
    expect(user.update).not.toHaveBeenCalled();
  });

  it("tells Google/GitHub-only accounts how to set a first password", async () => {
    user.findUnique.mockResolvedValue({ email: "a@b.com", passwordHash: null } as never);
    expect(await changePassword("u1", "anything", GOOD)).toEqual({ error: expect.stringMatching(/Forgot password/) });
    expect(user.update).not.toHaveBeenCalled();
  });

  it("reports a missing account", async () => {
    user.findUnique.mockResolvedValue(null);
    expect(await changePassword("u1", OLD, GOOD)).toEqual({ error: expect.stringMatching(/no longer exists/) });
  });

  it("still succeeds if the notification email fails", async () => {
    send.mockRejectedValue(new Error("smtp down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await changePassword("u1", OLD, GOOD)).toEqual({ ok: true });
  });
});
