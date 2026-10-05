import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { user: { findUnique: vi.fn() } } }));
vi.mock("@next-auth/prisma-adapter", () => ({ PrismaAdapter: vi.fn(() => ({})) }));

import { getServerSession } from "next-auth";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

beforeEach(() => vi.resetAllMocks());

describe("getSession", () => {
  it("returns null without looking anyone up when there is no session", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    expect(await getSession()).toBeNull();
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it("returns the session for an existing user", async () => {
    const session = { user: { id: "u1" } };
    vi.mocked(getServerSession).mockResolvedValue(session as never);
    vi.mocked(db.user.findUnique).mockResolvedValue({ id: "u1" } as never);
    expect(await getSession()).toBe(session);
  });

  it("treats a still-valid token for a deleted account as signed out", async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: "gone" } } as never);
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
    expect(await getSession()).toBeNull();
  });
});
