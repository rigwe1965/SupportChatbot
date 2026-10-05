import { createHash, randomBytes } from "node:crypto";
import type { AuthTokenType, Prisma } from "@prisma/client";
import { db } from "@/lib/db";

const HOUR = 60 * 60 * 1000;

/** How long each kind of link works. */
export const TOKEN_TTL_MS: Record<AuthTokenType, number> = {
  VERIFY_EMAIL: 24 * HOUR,
  RESET_PASSWORD: 1 * HOUR,
};

/** Only this hash is stored, so a database leak doesn't hand out working links. */
export const hashToken = (raw: string) => createHash("sha256").update(raw).digest("hex");

/**
 * Creates a fresh single-use token for the user and returns the raw value (for the email link).
 * Any earlier unused token of the same type is revoked so only the newest link works.
 */
export async function createToken(userId: string, type: AuthTokenType, now: number = Date.now()): Promise<string> {
  const raw = randomBytes(32).toString("base64url");
  await db.$transaction([
    db.authToken.deleteMany({ where: { userId, type } }),
    db.authToken.create({
      data: { userId, type, tokenHash: hashToken(raw), expiresAt: new Date(now + TOKEN_TTL_MS[type]) },
    }),
  ]);
  return raw;
}

/** Whether a link is still usable, without using it up (for showing the reset form). */
export async function isTokenValid(raw: string, type: AuthTokenType, now: number = Date.now()): Promise<boolean> {
  if (!raw) return false;
  const row = await db.authToken.findUnique({ where: { tokenHash: hashToken(raw) } });
  return !!row && row.type === type && !row.usedAt && row.expiresAt.getTime() > now;
}

/**
 * Uses a token up. Returns the user it belongs to, or null if it is unknown, the wrong type,
 * expired or already used. Safe against two requests racing: only one can flip `usedAt`.
 */
export async function consumeToken(
  raw: string,
  type: AuthTokenType,
  client: Prisma.TransactionClient | typeof db = db,
  now: number = Date.now(),
): Promise<{ userId: string } | null> {
  if (!raw) return null;
  const row = await client.authToken.findUnique({ where: { tokenHash: hashToken(raw) } });
  if (!row || row.type !== type || row.usedAt || row.expiresAt.getTime() <= now) return null;

  const { count } = await client.authToken.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: new Date(now) },
  });
  return count === 1 ? { userId: row.userId } : null;
}
