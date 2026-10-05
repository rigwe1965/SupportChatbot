import { db } from "@/lib/db";
import type { FeedbackRating } from "@/types";

const MAX_COMMENT_CHARS = 500;

/**
 * Answers worth rating are real knowledge-base answers (they cite sources) and the "couldn't find it"
 * reply (flagged low-confidence). Hand-off and "already escalated" notices have neither.
 */
export function isRateable(m: { sources: unknown; lowConfidence: boolean }): boolean {
  return m.lowConfidence || (Array.isArray(m.sources) && m.sources.length > 0);
}

export function parseFeedback(
  body: unknown,
): { value: { rating: FeedbackRating | null; comment: string | null } } | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const rating = b.rating;
  if (rating !== "UP" && rating !== "DOWN" && rating !== null) {
    return { error: "`rating` must be \"UP\", \"DOWN\" or null" };
  }

  let comment: string | null = null;
  if (b.comment !== undefined && b.comment !== null) {
    if (typeof b.comment !== "string") return { error: "`comment` must be a string" };
    const trimmed = b.comment.trim();
    if (trimmed.length > MAX_COMMENT_CHARS) {
      return { error: `Comment is too long (max ${MAX_COMMENT_CHARS} characters)` };
    }
    // Only a thumbs-down carries a reason.
    comment = rating === "DOWN" && trimmed ? trimmed : null;
  }
  return { value: { rating, comment } };
}

/**
 * Stores (or clears, with rating = null) the customer's feedback on an assistant message.
 * Returns false when the message doesn't exist or isn't in one of the user's conversations.
 */
export async function setFeedback(
  messageId: string,
  userId: string,
  rating: FeedbackRating | null,
  comment: string | null,
): Promise<boolean> {
  const owned = await db.message.findFirst({
    where: { id: messageId, role: "assistant", conversation: { userId } },
    select: { id: true },
  });
  if (!owned) return false;

  await db.message.update({
    where: { id: messageId },
    data: {
      feedback: rating,
      feedbackComment: rating ? comment : null,
      feedbackAt: rating ? new Date() : null,
    },
  });
  return true;
}
