import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => {
  const db = {
    authToken: { deleteMany: vi.fn(), create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  };
  return { db };
});

import { TOKEN_TTL_MS, consumeToken, createToken, hashToken, isTokenValid } from "@/lib/auth-tokens";
import { db } from "@/lib/db";

const tokens = vi.mocked(db.authToken);
const NOW = Date.UTC(2026, 0, 1, 12);

const row = (over = {}) => ({
  id: "t1",
  userId: "u1",
  type: "RESET_PASSWORD",
  tokenHash: "x",
  expiresAt: new Date(NOW + 60_000),
  usedAt: null,
  createdAt: new Date(NOW),
  ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(db.$transaction).mockImplementation((async (ops: unknown[]) => Promise.all(ops)) as never);
  tokens.deleteMany.mockResolvedValue({ count: 0 } as never);
  tokens.create.mockResolvedValue({} as never);
});

describe("hashToken", () => {
  it("is a hex SHA-256", () => {
    expect(hashToken("abc")).toBe(createHash("sha256").update("abc").digest("hex"));
  });
});

describe("createToken", () => {
  it("returns a long random URL-safe token that differs every time", async () => {
    const a = await createToken("u1", "RESET_PASSWORD", NOW);
    const b = await createToken("u1", "RESET_PASSWORD", NOW);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 random bytes
    expect(a).not.toBe(b);
  });

  it("stores only the hash, never the token itself", async () => {
    const raw = await createToken("u1", "RESET_PASSWORD", NOW);
    const { data } = tokens.create.mock.calls[0][0];
    expect(data.tokenHash).toBe(hashToken(raw));
    expect(JSON.stringify(tokens.create.mock.calls[0])).not.toContain(raw);
  });

  it("expires reset links after an hour and confirmation links after a day", async () => {
    await createToken("u1", "RESET_PASSWORD", NOW);
    await createToken("u1", "VERIFY_EMAIL", NOW);
    expect(tokens.create.mock.calls[0][0].data.expiresAt).toEqual(new Date(NOW + 60 * 60 * 1000));
    expect(tokens.create.mock.calls[1][0].data.expiresAt).toEqual(new Date(NOW + 24 * 60 * 60 * 1000));
    expect(TOKEN_TTL_MS.RESET_PASSWORD).toBeLessThan(TOKEN_TTL_MS.VERIFY_EMAIL);
  });

  it("revokes the user's earlier links of the same type so only the newest works", async () => {
    await createToken("u1", "RESET_PASSWORD", NOW);
    expect(tokens.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1", type: "RESET_PASSWORD" } });
  });
});

describe("isTokenValid", () => {
  it("accepts an unused, unexpired token of the right type", async () => {
    tokens.findUnique.mockResolvedValue(row() as never);
    expect(await isTokenValid("raw", "RESET_PASSWORD", NOW)).toBe(true);
    expect(tokens.findUnique).toHaveBeenCalledWith({ where: { tokenHash: hashToken("raw") } });
  });

  it.each([
    ["unknown", null],
    ["expired", row({ expiresAt: new Date(NOW - 1) })],
    ["expiring right now", row({ expiresAt: new Date(NOW) })],
    ["already used", row({ usedAt: new Date(NOW - 1000) })],
    ["wrong type", row({ type: "VERIFY_EMAIL" })],
  ])("rejects a token that is %s", async (_name, found) => {
    tokens.findUnique.mockResolvedValue(found as never);
    expect(await isTokenValid("raw", "RESET_PASSWORD", NOW)).toBe(false);
  });

  it("rejects an empty token without querying", async () => {
    expect(await isTokenValid("", "RESET_PASSWORD", NOW)).toBe(false);
    expect(tokens.findUnique).not.toHaveBeenCalled();
  });

  it("does not use the token up", async () => {
    tokens.findUnique.mockResolvedValue(row() as never);
    await isTokenValid("raw", "RESET_PASSWORD", NOW);
    expect(tokens.updateMany).not.toHaveBeenCalled();
  });
});

describe("consumeToken", () => {
  it("returns the owner and marks the token used", async () => {
    tokens.findUnique.mockResolvedValue(row() as never);
    tokens.updateMany.mockResolvedValue({ count: 1 });

    expect(await consumeToken("raw", "RESET_PASSWORD", db, NOW)).toEqual({ userId: "u1" });
    expect(tokens.updateMany).toHaveBeenCalledWith({
      where: { id: "t1", usedAt: null },
      data: { usedAt: new Date(NOW) },
    });
  });

  it.each([
    ["unknown", null],
    ["expired", row({ expiresAt: new Date(NOW - 1) })],
    ["already used", row({ usedAt: new Date(NOW - 1000) })],
    ["the wrong type", row({ type: "VERIFY_EMAIL" })],
  ])("returns null for a token that is %s, without touching anything", async (_name, found) => {
    tokens.findUnique.mockResolvedValue(found as never);
    expect(await consumeToken("raw", "RESET_PASSWORD", db, NOW)).toBeNull();
    expect(tokens.updateMany).not.toHaveBeenCalled();
  });

  it("only one of two simultaneous requests wins", async () => {
    tokens.findUnique.mockResolvedValue(row() as never);
    tokens.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

    const results = await Promise.all([
      consumeToken("raw", "RESET_PASSWORD", db, NOW),
      consumeToken("raw", "RESET_PASSWORD", db, NOW),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("rejects an empty token", async () => {
    expect(await consumeToken("", "RESET_PASSWORD", db, NOW)).toBeNull();
    expect(tokens.findUnique).not.toHaveBeenCalled();
  });

  it("works inside a transaction client", async () => {
    const tx = { authToken: { findUnique: vi.fn().mockResolvedValue(row()), updateMany: vi.fn().mockResolvedValue({ count: 1 }) } };
    expect(await consumeToken("raw", "RESET_PASSWORD", tx as never, NOW)).toEqual({ userId: "u1" });
    expect(tx.authToken.updateMany).toHaveBeenCalled();
    expect(tokens.updateMany).not.toHaveBeenCalled();
  });
});
