import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: vi.fn() },
    conversation: { findMany: vi.fn() },
    ticket: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/password", async (original) => ({
  ...(await original<typeof import("@/lib/password")>()),
  verifyAgainstDummy: vi.fn(),
}));

import { exportAccountData } from "@/lib/account-export";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/password";

const PASSWORD = "correct horse battery";
let hash: string;
beforeAll(async () => {
  hash = await hashPassword(PASSWORD);
});

const person = (over = {}) => ({
  id: "u1",
  name: "Ada",
  email: "ada@example.com",
  emailVerified: null,
  image: null,
  role: "FREE",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  passwordHash: hash,
  accounts: [{ provider: "google" }],
  ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(db.user.findUnique).mockResolvedValue(person() as never);
  vi.mocked(db.conversation.findMany).mockResolvedValue([{ id: "c1", title: "Hi", messages: [] }] as never);
  vi.mocked(db.ticket.findMany).mockResolvedValue([{ id: "t1" }] as never);
});

describe("exportAccountData", () => {
  it("returns the profile, conversations and tickets", async () => {
    const r = await exportAccountData("u1", { password: PASSWORD }, new Date("2026-10-05T12:00:00Z"));
    if (!("ok" in r)) throw new Error("expected success");
    expect(r.filename).toBe("my-data-2026-10-05.json");
    expect(r.data).toMatchObject({
      exportedAt: "2026-10-05T12:00:00.000Z",
      profile: { id: "u1", email: "ada@example.com", hasPassword: true, signInProviders: ["google"] },
      conversations: [{ id: "c1" }],
      tickets: [{ id: "t1" }],
    });
  });

  it("only ever queries the caller's own rows", async () => {
    await exportAccountData("u1", { password: PASSWORD });
    expect(db.conversation.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "u1" } }));
    expect(db.ticket.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "u1" } }));
  });

  it("never includes the password hash or provider tokens", async () => {
    const r = await exportAccountData("u1", { password: PASSWORD });
    const json = JSON.stringify(r);
    expect(json).not.toContain("scrypt$");
    expect(json).not.toContain("passwordHash");
    const select = vi.mocked(db.user.findUnique).mock.calls[0][0]!.select as { accounts: { select: object } };
    expect(Object.keys(select.accounts.select)).toEqual(["provider"]); // no access/refresh/id tokens
  });

  it("doesn't select admin bookkeeping fields", async () => {
    await exportAccountData("u1", { password: PASSWORD });
    const messageFields = Object.keys(
      (vi.mocked(db.conversation.findMany).mock.calls[0][0] as any).select.messages.select,
    );
    expect(messageFields).not.toContain("feedbackReviewedAt");
    const ticketFields = Object.keys((vi.mocked(db.ticket.findMany).mock.calls[0][0] as any).select);
    expect(ticketFields).not.toContain("slackPostedAt");
    expect(ticketFields).not.toContain("userEmail");
  });

  it("requires the right password for accounts that have one, and reads nothing otherwise", async () => {
    for (const password of ["wrong password!", "", undefined, 5]) {
      expect(await exportAccountData("u1", { password })).toEqual({ error: expect.stringMatching(/password/i), status: 400 });
    }
    expect(db.conversation.findMany).not.toHaveBeenCalled();
    expect(db.ticket.findMany).not.toHaveBeenCalled();
  });

  it("Google/GitHub accounts need no password", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(person({ passwordHash: null }) as never);
    const r = await exportAccountData("u1", {});
    expect("ok" in r && r.data.profile).toMatchObject({ hasPassword: false });
  });

  it("reports an account that no longer exists", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
    expect(await exportAccountData("u1", {})).toEqual({ error: expect.any(String), status: 404 });
  });
});
