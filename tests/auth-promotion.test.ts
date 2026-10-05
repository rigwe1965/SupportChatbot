import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: { user: { update: vi.fn() } } }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@next-auth/prisma-adapter", () => ({ PrismaAdapter: vi.fn(() => ({})) }));

import { recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";

async function signInEvent(adminEmails: string) {
  vi.resetModules();
  vi.stubEnv("ADMIN_EMAILS", adminEmails);
  const { authOptions } = await import("@/lib/auth");
  return authOptions.events!.signIn!;
}

const call = (fn: Awaited<ReturnType<typeof signInEvent>>, user: Record<string, unknown>) =>
  fn({ user, account: null, isNewUser: false } as never);

beforeEach(() => vi.clearAllMocks());

describe("ADMIN_EMAILS promotion on sign-in", () => {
  it("promotes a listed email (case-insensitively) and writes an audit entry", async () => {
    const signIn = await signInEvent("Boss@Example.com, other@example.com");
    await call(signIn, { id: "u1", email: "boss@example.com", role: "FREE" });

    expect(db.user.update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { role: "ADMIN" } });
    expect(recordAudit).toHaveBeenCalledWith(
      { userId: "u1", email: "boss@example.com" },
      expect.objectContaining({
        action: "user.promoted_admin",
        targetType: "user",
        targetId: "u1",
        summary: expect.stringContaining("boss@example.com"),
      }),
    );
  });

  it("does nothing for users who aren't listed", async () => {
    const signIn = await signInEvent("boss@example.com");
    await call(signIn, { id: "u2", email: "customer@example.com", role: "FREE" });
    expect(db.user.update).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("doesn't log again for someone who is already an admin", async () => {
    const signIn = await signInEvent("boss@example.com");
    await call(signIn, { id: "u1", email: "boss@example.com", role: "ADMIN" });
    expect(db.user.update).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("promotes nobody when ADMIN_EMAILS is empty", async () => {
    const signIn = await signInEvent("");
    await call(signIn, { id: "u1", email: "boss@example.com", role: "FREE" });
    expect(db.user.update).not.toHaveBeenCalled();
  });
});

async function options(adminEmails: string) {
  vi.resetModules();
  vi.stubEnv("ADMIN_EMAILS", adminEmails);
  return (await import("@/lib/auth")).authOptions;
}

describe("password sign-ups can't claim an admin address", () => {
  const admin = "boss@example.com";
  const credentialsAccount = { provider: "credentials", type: "credentials", providerAccountId: "u1" };

  it("is not promoted when the email was never confirmed", async () => {
    const o = await options(admin);
    await o.events!.signIn!({
      user: { id: "u1", email: admin, role: "FREE", emailVerified: null },
      account: credentialsAccount,
      isNewUser: false,
    } as never);
    expect(db.user.update).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("does not get an admin session token either", async () => {
    const o = await options(admin);
    const token = await o.callbacks!.jwt!({
      token: {},
      user: { id: "u1", email: admin, role: "FREE", emailVerified: null },
      account: credentialsAccount,
    } as never);
    expect(token.role).toBe("FREE");
  });

  it("is promoted once the email is confirmed", async () => {
    const o = await options(admin);
    const user = { id: "u1", email: admin, role: "FREE", emailVerified: new Date() };

    await o.events!.signIn!({ user, account: credentialsAccount, isNewUser: false } as never);
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { role: "ADMIN" } });

    const token = await o.callbacks!.jwt!({ token: {}, user, account: credentialsAccount } as never);
    expect(token.role).toBe("ADMIN");
  });

  it("Google/GitHub sign-ins are still trusted without an emailVerified date", async () => {
    const o = await options(admin);
    const user = { id: "u1", email: admin, role: "FREE", emailVerified: null };
    const token = await o.callbacks!.jwt!({ token: {}, user, account: { provider: "google", type: "oauth" } } as never);
    expect(token.role).toBe("ADMIN");
  });

  it("registers the email+password provider", async () => {
    const o = await options(admin);
    expect(o.providers.map((p) => p.id)).toEqual(["google", "github", "credentials"]);
  });
});
