import { db } from "@/lib/db";
import { verifyAgainstDummy, verifyPassword } from "@/lib/password";

export type ExportResult =
  | { ok: true; data: Record<string, unknown>; filename: string }
  | { error: string; status: 400 | 404 };

/**
 * Everything we hold about one person, as a plain object for a JSON download.
 *
 * Deliberately left out: the password hash, one-time links, and OAuth provider tokens (credentials,
 * not the person's data), plus internal admin bookkeeping (review state, Slack/email delivery times).
 * Needs the current password for accounts that have one, like deleting an account does.
 */
export async function exportAccountData(userId: string, input: { password?: unknown }, now = new Date()): Promise<ExportResult> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      emailVerified: true,
      image: true,
      role: true,
      createdAt: true,
      passwordHash: true,
      accounts: { select: { provider: true } },
    },
  });
  if (!user) return { error: "This account no longer exists.", status: 404 };

  if (user.passwordHash) {
    const password = typeof input.password === "string" ? input.password : "";
    if (!password || !(await verifyPassword(password, user.passwordHash))) {
      return { error: "Your password is incorrect", status: 400 };
    }
  } else if (typeof input.password === "string") {
    await verifyAgainstDummy(input.password);
  }

  const [conversations, tickets] = await Promise.all([
    db.conversation.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
        messages: {
          orderBy: { createdAt: "asc" },
          select: {
            role: true,
            content: true,
            sources: true,
            feedback: true,
            feedbackComment: true,
            feedbackAt: true,
            createdAt: true,
          },
        },
      },
    }),
    db.ticket.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        status: true,
        reason: true,
        question: true,
        lastAnswer: true,
        transcript: true,
        createdAt: true,
        resolvedAt: true,
      },
    }),
  ]);

  return {
    ok: true,
    filename: `my-data-${now.toISOString().slice(0, 10)}.json`,
    data: {
      exportedAt: now.toISOString(),
      profile: {
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
        image: user.image,
        role: user.role,
        createdAt: user.createdAt,
        hasPassword: !!user.passwordHash,
        signInProviders: user.accounts.map((a) => a.provider),
      },
      conversations,
      tickets,
    },
  };
}
