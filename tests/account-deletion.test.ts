import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: vi.fn(), count: vi.fn(), delete: vi.fn() },
    ticket: { updateMany: vi.fn() },
    conversation: { deleteMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/account-email", async (original) => ({
  ...(await original<typeof import("@/lib/account-email")>()),
  sendAccountEmail: vi.fn(),
}));
vi.mock("@/lib/password", async (original) => ({
  ...(await original<typeof import("@/lib/password")>()),
  verifyAgainstDummy: vi.fn(),
}));

import { sendAccountEmail } from "@/lib/account-email";
import { deleteAccount } from "@/lib/account-deletion";
import { recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/password";

const PASSWORD = "correct horse battery";
let hash: string;
beforeAll(async () => {
  hash = await hashPassword(PASSWORD);
});

const person = (over = {}) => ({ id: "u1", email: "ada@example.com", name: "Ada", role: "FREE", passwordHash: hash, ...over });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(db.user.findUnique).mockResolvedValue(person() as never);
  vi.mocked(db.user.count).mockResolvedValue(2);
  vi.mocked(db.$transaction).mockResolvedValue([] as never);
  vi.mocked(sendAccountEmail).mockResolvedValue(true);
});

const untouched = () => {
  expect(db.$transaction).not.toHaveBeenCalled();
  expect(db.user.delete).not.toHaveBeenCalled();
  expect(sendAccountEmail).not.toHaveBeenCalled();
};

describe("deleteAccount", () => {
  it("deletes the account, its conversations, and anonymises its tickets, in one transaction", async () => {
    expect(await deleteAccount("u1", { password: PASSWORD, confirm: "DELETE" })).toEqual({ ok: true });

    expect(db.ticket.updateMany).toHaveBeenCalledWith({
      where: { userId: "u1" },
      data: {
        userId: null,
        userName: null,
        userEmail: null,
        question: expect.stringContaining("removed"),
        lastAnswer: null,
        transcript: [],
      },
    });
    expect(db.conversation.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
    expect(db.user.delete).toHaveBeenCalledWith({ where: { id: "u1" } });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(vi.mocked(db.$transaction).mock.calls[0][0]).toHaveLength(3);
  });

  it("emails the owner that the account is gone", async () => {
    await deleteAccount("u1", { password: PASSWORD, confirm: "DELETE" });
    expect(sendAccountEmail).toHaveBeenCalledWith("ada@example.com", expect.objectContaining({ subject: expect.stringMatching(/deleted/i) }));
  });

  it("still succeeds if the notification email fails", async () => {
    vi.mocked(sendAccountEmail).mockRejectedValue(new Error("smtp down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await deleteAccount("u1", { password: PASSWORD, confirm: "DELETE" })).toEqual({ ok: true });
  });

  describe("confirmation", () => {
    it.each([undefined, "", "delete", "DELETE ", "yes"])("requires the exact word, not %j", async (confirm) => {
      expect(await deleteAccount("u1", { password: PASSWORD, confirm })).toEqual({ error: expect.stringMatching(/DELETE/), status: 400 });
      untouched();
    });

    it("refuses a wrong or missing password for accounts that have one", async () => {
      for (const password of ["wrong password!", "", undefined, 5]) {
        expect(await deleteAccount("u1", { password, confirm: "DELETE" })).toEqual({
          error: expect.stringMatching(/password/i),
          status: 400,
        });
      }
      untouched();
    });

    it("Google/GitHub accounts (no password) only need the typed word", async () => {
      vi.mocked(db.user.findUnique).mockResolvedValue(person({ passwordHash: null }) as never);
      expect(await deleteAccount("u1", { confirm: "DELETE" })).toEqual({ ok: true });
      expect(db.user.delete).toHaveBeenCalled();
    });
  });

  it("reports an account that no longer exists", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
    expect(await deleteAccount("u1", { password: PASSWORD, confirm: "DELETE" })).toEqual({ error: expect.any(String), status: 404 });
    untouched();
  });

  describe("admins", () => {
    beforeEach(() => vi.mocked(db.user.findUnique).mockResolvedValue(person({ role: "ADMIN" }) as never));

    it("the only admin can't delete themselves", async () => {
      vi.mocked(db.user.count).mockResolvedValue(1);
      expect(await deleteAccount("u1", { password: PASSWORD, confirm: "DELETE" })).toEqual({
        error: expect.stringMatching(/only admin/),
        status: 409,
      });
      untouched();
      expect(db.user.count).toHaveBeenCalledWith({ where: { role: "ADMIN" } });
    });

    it("an admin can when another exists, and it is audited without a (deleted) actor", async () => {
      expect(await deleteAccount("u1", { password: PASSWORD, confirm: "DELETE" })).toEqual({ ok: true });
      expect(recordAudit).toHaveBeenCalledWith(
        null,
        expect.objectContaining({ action: "user.delete_account", targetId: "u1" }),
        undefined,
      );
    });
  });

  it("doesn't write an audit entry for ordinary customers", async () => {
    await deleteAccount("u1", { password: PASSWORD, confirm: "DELETE" });
    expect(recordAudit).not.toHaveBeenCalled();
  });
});
