import { db } from "@/lib/db";
import {
  alreadyRegisteredContent,
  passwordChangedContent,
  resetPasswordContent,
  sendAccountEmail,
  verifyEmailContent,
} from "@/lib/account-email";
import { consumeToken, createToken } from "@/lib/auth-tokens";
import { hashPassword, validatePassword, verifyPassword } from "@/lib/password";

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/** Lower-cases and validates an email; null if it isn't one. */
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && EMAIL_RE.test(email) ? email : null;
}

type Result = { ok: true } | { error: string };

export const INVALID_LINK = "This link is invalid or has expired.";

/**
 * Creates a password account and emails a confirmation link. The outcome never depends on whether the
 * address is already registered (so this can't be used to find out who has an account):
 *  - new address            → account created, confirmation email
 *  - unconfirmed signup     → password replaced (it was never proven to be theirs), confirmation email
 *  - existing account       → untouched; an "you already have an account" email is sent instead
 */
export async function registerUser(input: { name?: unknown; email: unknown; password: unknown }): Promise<Result> {
  const email = normalizeEmail(input.email);
  if (!email) return { error: "Enter a valid email address" };
  const passwordError = validatePassword(input.password);
  if (passwordError) return { error: passwordError };
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 100) || null : null;

  const passwordHash = await hashPassword(input.password as string);
  const existing = await db.user.findUnique({ where: { email } });

  if (!existing) {
    const user = await db.user.create({ data: { email, name, passwordHash } });
    await sendAccountEmail(email, verifyEmailContent(await createToken(user.id, "VERIFY_EMAIL")));
  } else if (existing.passwordHash && !existing.emailVerified) {
    // A signup nobody confirmed: let the newest attempt win, otherwise whoever typed the address first
    // could squat on it. Accounts that signed in with Google/GitHub never reach this branch.
    await db.user.update({ where: { id: existing.id }, data: { passwordHash, name: name ?? existing.name } });
    await sendAccountEmail(email, verifyEmailContent(await createToken(existing.id, "VERIFY_EMAIL")));
  } else {
    // Never attach a password to an account through signup: that would let a stranger take over
    // a Google/GitHub account just by knowing its email.
    await sendAccountEmail(email, alreadyRegisteredContent());
  }
  return { ok: true };
}

/** Marks the address as confirmed. */
export async function verifyEmail(token: string): Promise<Result> {
  const ok = await db.$transaction(async (tx) => {
    const found = await consumeToken(token, "VERIFY_EMAIL", tx);
    if (!found) return false;
    await tx.user.update({ where: { id: found.userId }, data: { emailVerified: new Date() } });
    return true;
  });
  return ok ? { ok: true } : { error: INVALID_LINK };
}

/**
 * Emails a reset link if the address has an account; does nothing otherwise. Callers must respond the
 * same way in both cases. Works for Google/GitHub accounts too, which is how they add a password.
 */
export async function requestPasswordReset(emailInput: unknown): Promise<void> {
  const email = normalizeEmail(emailInput);
  if (!email) return;
  const user = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) return;
  await sendAccountEmail(email, resetPasswordContent(await createToken(user.id, "RESET_PASSWORD")));
}

/** Sets a new password using a reset link. The link is only used up if the password is acceptable. */
export async function resetPassword(token: string, newPassword: unknown): Promise<Result> {
  const passwordError = validatePassword(newPassword);
  if (passwordError) return { error: passwordError };
  const passwordHash = await hashPassword(newPassword as string);

  const email = await db.$transaction(async (tx) => {
    const found = await consumeToken(token, "RESET_PASSWORD", tx);
    if (!found) return null;
    const user = await tx.user.findUnique({
      where: { id: found.userId },
      select: { email: true, emailVerified: true },
    });
    if (!user) return null;
    await tx.user.update({
      where: { id: found.userId },
      // Following a link sent to the address proves its owner, so it counts as confirmed too.
      data: { passwordHash, emailVerified: user.emailVerified ?? new Date() },
    });
    // Any other outstanding links for this account are void now.
    await tx.authToken.deleteMany({ where: { userId: found.userId } });
    return user.email;
  });

  if (!email) return { error: INVALID_LINK };
  await sendAccountEmail(email, passwordChangedContent());
  return { ok: true };
}

export const NO_PASSWORD_YET =
  'Your account signs in with Google or GitHub and has no password yet. Use "Forgot password" on the sign-in page to set one.';

/**
 * Changes the password of a signed-in person who knows the current one. Outstanding email links
 * (e.g. an old reset link) are voided, and the owner is told by email.
 */
export async function changePassword(userId: string, currentPassword: unknown, newPassword: unknown): Promise<Result> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { email: true, passwordHash: true } });
  if (!user) return { error: "This account no longer exists." };
  if (!user.passwordHash) return { error: NO_PASSWORD_YET };

  const current = typeof currentPassword === "string" ? currentPassword : "";
  if (!current || !(await verifyPassword(current, user.passwordHash))) {
    return { error: "Your current password is incorrect" };
  }

  const passwordError = validatePassword(newPassword);
  if (passwordError) return { error: passwordError };
  if (newPassword === current) return { error: "Choose a password different from your current one" };

  const passwordHash = await hashPassword(newPassword as string);
  await db.$transaction([
    db.user.update({ where: { id: userId }, data: { passwordHash } }),
    db.authToken.deleteMany({ where: { userId } }),
  ]);

  if (user.email) {
    await sendAccountEmail(user.email, passwordChangedContent()).catch((err) =>
      console.error("password changed email failed", err),
    );
  }
  return { ok: true };
}
