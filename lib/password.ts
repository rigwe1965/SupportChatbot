import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

// scrypt (built into Node, so no native dependency). Parameters follow OWASP's guidance
// (N=2^16, r=8, p=2) and are stored in each hash, so they can be raised later without breaking old hashes.
const N = 2 ** 16;
const R = 8;
const P = 2;
const KEY_LEN = 32;
const MAX_MEM = 256 * 1024 * 1024;

export const MIN_PASSWORD_LENGTH = 10;
/** Upper bound so a huge "password" can't be used to burn CPU. */
export const MAX_PASSWORD_LENGTH = 128;

function derive(password: string, salt: Buffer, n: number, r: number, p: number, len: number): Promise<Buffer> {
  const options: ScryptOptions = { N: n, r, p, maxmem: MAX_MEM };
  return new Promise((resolve, reject) =>
    scrypt(password.normalize("NFKC"), salt, len, options, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

/** Returns `scrypt$N$r$p$salt$hash` (salt and hash base64). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P, KEY_LEN);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

/** Constant-time check. Malformed or unknown hash formats simply fail. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const params = [n, r, p].map(Number);
  if (params.some((v) => !Number.isInteger(v) || v <= 0)) return false;

  try {
    const expected = Buffer.from(hash, "base64");
    const actual = await derive(password, Buffer.from(salt, "base64"), params[0], params[1], params[2], expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;
/**
 * Burns the same CPU as a real check. Call it when the account doesn't exist so response time
 * doesn't reveal which emails are registered.
 */
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
  await verifyPassword(password, await dummyHash);
}

/** Returns a message describing what's wrong with the password, or null if it's acceptable. */
export function validatePassword(password: unknown): string | null {
  if (typeof password !== "string") return "Password is required";
  if (password.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  if (password.length > MAX_PASSWORD_LENGTH) return `Password must be at most ${MAX_PASSWORD_LENGTH} characters`;
  if (/^(.)\1+$/.test(password)) return "Password is too easy to guess";
  if (password.trim().length === 0) return "Password can't be only spaces";
  return null;
}
