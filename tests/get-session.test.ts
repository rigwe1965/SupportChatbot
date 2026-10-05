import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { user: { findUnique: vi.fn() } } }));
vi.mock("@next-auth/prisma-adapter", () => ({ PrismaAdapter: vi.fn(() => ({})) }));

import { getServerSession } from "next-auth";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

const T0 = new Date("2026-10-05T12:00:00Z");
const signedInAt = (offsetMs: number | undefined) => ({
  user: { id: "u1" },
  authAt: offsetMs === undefined ? undefined : T0.getTime() + offsetMs,
});
const dbUser = (sessionsValidFrom: Date | null) =>
  vi.mocked(db.user.findUnique).mockResolvedValue({ sessionsValidFrom } as never);

beforeEach(() => vi.resetAllMocks());

describe("getSession", () => {
  it("returns null without looking anyone up when there is no session", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    expect(await getSession()).toBeNull();
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it("returns the session for an existing user who never signed everyone out", async () => {
    const session = signedInAt(0);
    vi.mocked(getServerSession).mockResolvedValue(session as never);
    dbUser(null);
    expect(await getSession()).toBe(session);
  });

  it("treats a still-valid token for a deleted account as signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue(signedInAt(0) as never);
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
    expect(await getSession()).toBeNull();
  });

  describe("after 'sign out everywhere'", () => {
    it("rejects a sign-in from before the cutoff", async () => {
      vi.mocked(getServerSession).mockResolvedValue(signedInAt(-1) as never);
      dbUser(T0);
      expect(await getSession()).toBeNull();
    });

    it("accepts a sign-in at or after the cutoff", async () => {
      for (const offset of [0, 1, 60_000]) {
        const session = signedInAt(offset);
        vi.mocked(getServerSession).mockResolvedValue(session as never);
        dbUser(T0);
        expect(await getSession()).toBe(session);
      }
    });

    it("rejects tokens that predate sign-in times (no authAt)", async () => {
      vi.mocked(getServerSession).mockResolvedValue(signedInAt(undefined) as never);
      dbUser(T0);
      expect(await getSession()).toBeNull();
    });
  });
});
