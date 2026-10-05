import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export type FeedbackStatus = "todo" | "reviewed" | "all";

export interface NegativeFeedbackItem {
  id: string;
  conversationId: string;
  /** The customer message that this answer replied to. */
  question: string | null;
  answer: string;
  /** Reason the customer gave for the thumbs down, if any. */
  comment: string | null;
  /** Knowledge-base articles the answer cited; empty means nothing matched. */
  sources: { title: string; category: string }[];
  feedbackAt: Date;
  reviewedAt: Date | null;
  userName: string | null;
  userEmail: string | null;
}

export const FEEDBACK_PAGE_SIZE = 100;

interface Row {
  id: string;
  conversationId: string;
  question: string | null;
  answer: string;
  comment: string | null;
  sources: unknown;
  feedbackAt: Date;
  reviewedAt: Date | null;
  userName: string | null;
  userEmail: string | null;
}

/** Thumbs-down answers, newest first, each with the customer message it answered. */
export async function listNegativeFeedback(status: FeedbackStatus): Promise<NegativeFeedbackItem[]> {
  const statusFilter =
    status === "todo"
      ? Prisma.sql`AND m."feedbackReviewedAt" IS NULL`
      : status === "reviewed"
        ? Prisma.sql`AND m."feedbackReviewedAt" IS NOT NULL`
        : Prisma.empty;

  const rows = await db.$queryRaw<Row[]>`
    SELECT m."id",
           m."conversationId",
           q."content" AS "question",
           m."content" AS "answer",
           m."feedbackComment" AS "comment",
           m."sources",
           m."feedbackAt",
           m."feedbackReviewedAt" AS "reviewedAt",
           u."name" AS "userName",
           u."email" AS "userEmail"
    FROM "Message" m
    JOIN "Conversation" c ON c."id" = m."conversationId"
    LEFT JOIN "User" u ON u."id" = c."userId"
    LEFT JOIN LATERAL (
      SELECT x."content" FROM "Message" x
      WHERE x."conversationId" = m."conversationId" AND x."role" = 'user' AND x."createdAt" <= m."createdAt"
      ORDER BY x."createdAt" DESC LIMIT 1
    ) q ON true
    WHERE m."role" = 'assistant' AND m."feedback" = 'DOWN' ${statusFilter}
    ORDER BY m."feedbackAt" DESC
    LIMIT ${FEEDBACK_PAGE_SIZE}`;

  return rows.map((r) => ({
    ...r,
    sources: Array.isArray(r.sources)
      ? (r.sources as { title?: unknown; category?: unknown }[])
          .filter((s) => typeof s?.title === "string")
          .map((s) => ({ title: s.title as string, category: typeof s.category === "string" ? s.category : "" }))
      : [],
  }));
}

/** Thumbs-downs nobody has looked at yet (drives the nav badge). */
export const countUnreviewedNegative = () =>
  db.message.count({ where: { role: "assistant", feedback: "DOWN", feedbackReviewedAt: null } });

/** Marks a thumbs-down reviewed (or back to unreviewed). Returns false if it isn't a thumbs-down. */
export async function setReviewed(messageId: string, reviewed: boolean): Promise<boolean> {
  const { count } = await db.message.updateMany({
    where: { id: messageId, role: "assistant", feedback: "DOWN" },
    data: { feedbackReviewedAt: reviewed ? new Date() : null },
  });
  return count > 0;
}
