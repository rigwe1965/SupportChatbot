import { toCsv } from "@/lib/csv";
import type { NegativeFeedbackItem } from "@/lib/feedback-review";

export const FEEDBACK_EXPORT_LIMIT = 10_000;

const HEADER = [
  "Rated at (UTC)",
  "Status",
  "Reviewed at (UTC)",
  "User name",
  "User email",
  "Question",
  "Answer",
  "Customer reason",
  "Cited articles",
  "Conversation ID",
  "Message ID",
];

export function feedbackToCsv(items: NegativeFeedbackItem[]): string {
  return toCsv(
    HEADER,
    items.map((f) => [
      f.feedbackAt,
      f.reviewedAt ? "Reviewed" : "To review",
      f.reviewedAt,
      f.userName,
      f.userEmail,
      f.question,
      f.answer,
      f.comment,
      f.sources.map((s) => (s.category ? `${s.title} (${s.category})` : s.title)).join(" | "),
      f.conversationId,
      f.id,
    ]),
  );
}
