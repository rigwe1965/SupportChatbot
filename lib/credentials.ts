import { db } from "@/lib/db";
import { normalizeEmail } from "@/lib/account";
import { rateLimit } from "@/lib/rate-limit";
import { MAX_PASSWORD_LENGTH, verifyAgainstDummy, verifyPassword } from "@/lib/password";
import type { UserRole } from "@/types/next-auth";

const LOGIN_WINDOW = 15 * 60;

/**
 * Checks an email + password for NextAuth's Credentials provider.
 *
 * Returns the user, or null for any wrong combination (the same answer whether the email exists or not,
 * and it takes the same time). Throws, so the sign-in page can explain, for:
 *  - "RateLimited": too many attempts for this email or from this IP
 *  - "EmailNotVerified": the password is right but the address hasn't been confirmed
 */
export async function authorizeCredentials(
  credentials: Record<string, string> | undefined,
  ip: string | null,
) {
  const email = normalizeEmail(credentials?.email);
  const password = credentials?.password;
  if (!email || typeof password !== "string" || !password || password.length > MAX_PASSWORD_LENGTH) return null;

  const [byEmail, byIp] = await Promise.all([
    rateLimit(`login:email:${email}`, [{ name: "15min", limit: 10, windowSeconds: LOGIN_WINDOW }]),
    rateLimit(`login:ip:${ip ?? "unknown"}`, [{ name: "15min", limit: 30, windowSeconds: LOGIN_WINDOW }]),
  ]);
  if (!byEmail.allowed || !byIp.allowed) throw new Error("RateLimited");

  const user = await db.user.findUnique({ where: { email } });
  if (!user?.passwordHash) {
    // No such account, or one that only uses Google/GitHub.
    await verifyAgainstDummy(password);
    return null;
  }
  if (!(await verifyPassword(password, user.passwordHash))) return null;
  if (!user.emailVerified) throw new Error("EmailNotVerified");

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.image,
    role: user.role as UserRole,
    emailVerified: user.emailVerified,
  };
}
