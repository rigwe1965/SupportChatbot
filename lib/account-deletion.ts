import { recordAudit } from "@/lib/audit";
import { accountDeletedContent, sendAccountEmail } from "@/lib/account-email";
import { db } from "@/lib/db";
import { verifyAgainstDummy, verifyPassword } from "@/lib/password";

export const DELETE_CONFIRMATION = "DELETE";

export type DeleteResult = { ok: true } | { error: string; status: 400 | 401 | 404 | 409 };

/**
 * Permanently deletes the signed-in person's account and personal data.
 *
 * - Needs the typed confirmation word, and the current password for accounts that have one.
 * - Conversations and their messages are deleted.
 * - Support tickets are kept for the support team's records but stripped of anything identifying
 *   (name, email, transcript, question, answer), since a transcript is the person's own words.
 * - Sign-in methods, sessions and email links go with the account (cascade).
 * - Articles an admin wrote stay, without an author; audit entries stay (the actor's email in them
 *   is by design, see the AuditLog model).
 * - The last remaining admin can't delete themselves, so the dashboard is never left without one.
 */
export async function deleteAccount(
  userId: string,
  input: { password?: unknown; confirm?: unknown },
  req?: Request,
): Promise<DeleteResult> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, role: true, passwordHash: true },
  });
  if (!user) return { error: "This account no longer exists.", status: 404 };

  if (input.confirm !== DELETE_CONFIRMATION) {
    return { error: `Type ${DELETE_CONFIRMATION} to confirm`, status: 400 };
  }

  if (user.passwordHash) {
    const password = typeof input.password === "string" ? input.password : "";
    if (!password || !(await verifyPassword(password, user.passwordHash))) {
      return { error: "Your password is incorrect", status: 400 };
    }
  } else if (typeof input.password === "string") {
    await verifyAgainstDummy(input.password);
  }

  if (user.role === "ADMIN") {
    const admins = await db.user.count({ where: { role: "ADMIN" } });
    if (admins <= 1) {
      return { error: "You're the only admin. Make someone else an admin before deleting this account.", status: 409 };
    }
  }

  await db.$transaction([
    // Keep the ticket rows, drop everything that identifies or quotes the person.
    db.ticket.updateMany({
      where: { userId: user.id },
      data: {
        userId: null,
        userName: null,
        userEmail: null,
        question: "[removed: account deleted]",
        lastAnswer: null,
        transcript: [],
      },
    }),
    // Messages go with their conversation (cascade).
    db.conversation.deleteMany({ where: { userId: user.id } }),
    // Accounts, sessions and auth tokens cascade; articles and audit entries lose their link.
    db.user.delete({ where: { id: user.id } }),
  ]);

  if (user.role === "ADMIN") {
    // The actor row is gone now, so this is recorded without one.
    await recordAudit(
      null,
      {
        action: "user.delete_account",
        targetType: "user",
        targetId: user.id,
        summary: `Admin ${user.email ?? user.id} deleted their own account`,
      },
      req,
    );
  }

  if (user.email) {
    // Best-effort: the deletion has already happened.
    await sendAccountEmail(user.email, accountDeletedContent()).catch((err) =>
      console.error("account deleted email failed", err),
    );
  }

  return { ok: true };
}
