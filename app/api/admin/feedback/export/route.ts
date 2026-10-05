import { NextResponse } from "next/server";
import { FEEDBACK_EXPORT_LIMIT, feedbackToCsv } from "@/lib/feedback-export";
import { listNegativeFeedback, parseFeedbackStatus } from "@/lib/feedback-review";
import { requireAdmin } from "@/lib/guard";

export const dynamic = "force-dynamic";

/** Downloads thumbs-down feedback as CSV, for the same status filter as the review page. */
export async function GET(req: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const status = parseFeedbackStatus(new URL(req.url).searchParams.get("status"));
  const items = await listNegativeFeedback(status, FEEDBACK_EXPORT_LIMIT);

  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(feedbackToCsv(items), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="feedback-${status}-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
