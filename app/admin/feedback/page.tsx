import Link from "next/link";
import ReviewFeedbackButton from "@/components/admin/ReviewFeedbackButton";
import { requireAdminPage } from "@/lib/admin-page";
import { FEEDBACK_PAGE_SIZE, listNegativeFeedback, type FeedbackStatus } from "@/lib/feedback-review";

const FILTERS: { key: FeedbackStatus; label: string }[] = [
  { key: "todo", label: "To review" },
  { key: "reviewed", label: "Reviewed" },
  { key: "all", label: "All" },
];

export default async function FeedbackPage({ searchParams }: { searchParams: { status?: string } }) {
  await requireAdminPage("/admin/feedback");
  const status = FILTERS.find((f) => f.key === searchParams.status)?.key ?? "todo";
  const items = await listNegativeFeedback(status);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Customer feedback</h1>
          <p className="text-sm text-muted">Answers customers marked as not helpful</p>
        </div>
        <div className="inline-flex rounded-lg border border-border p-0.5 text-sm" role="group" aria-label="Status">
          {FILTERS.map((f) => (
            <Link
              key={f.key}
              href={`/admin/feedback?status=${f.key}`}
              aria-current={f.key === status ? "true" : undefined}
              className={`rounded-md px-3 py-1 ${
                f.key === status ? "bg-brand text-brand-foreground" : "text-muted hover:text-foreground"
              }`}
            >
              {f.label}
            </Link>
          ))}
        </div>
      </div>

      {items.length === 0 ? (
        <p className="text-muted">
          {status === "todo" ? "Nothing to review. 🎉" : "No feedback here yet."}
        </p>
      ) : (
        <ul className="space-y-4">
          {items.map((f) => (
            <li key={f.id} className="space-y-4 rounded-xl border border-border p-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="font-medium">{f.userName ?? f.userEmail ?? "Unknown user"}</span>
                {f.userName && f.userEmail && <span className="text-muted">{f.userEmail}</span>}
                <span className="text-muted">{f.feedbackAt.toLocaleString()}</span>
                {f.reviewedAt && (
                  <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-xs text-muted">
                    Reviewed {f.reviewedAt.toLocaleDateString()}
                  </span>
                )}
                <span className="ml-auto">
                  <ReviewFeedbackButton id={f.id} reviewed={!!f.reviewedAt} />
                </span>
              </div>

              <div className="rounded-lg bg-foreground/5 p-3 text-sm">
                <p className="text-xs font-medium text-muted">Customer reason</p>
                <p className="mt-0.5 whitespace-pre-wrap break-words">
                  {f.comment ?? <span className="text-muted">No reason given</span>}
                </p>
              </div>

              <div className="grid gap-4 text-sm sm:grid-cols-2">
                <div>
                  <p className="text-xs font-medium text-muted">Question</p>
                  <p className="mt-0.5 whitespace-pre-wrap break-words">{f.question ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted">Answer</p>
                  <p className="mt-0.5 whitespace-pre-wrap break-words">{f.answer}</p>
                </div>
              </div>

              <div className="text-xs text-muted">
                {f.sources.length > 0 ? (
                  <>
                    <span className="font-medium">Cited:</span>{" "}
                    {f.sources.map((s) => (s.category ? `${s.title} (${s.category})` : s.title)).join(" · ")}
                  </>
                ) : (
                  <span>No matching article, possibly a gap in the knowledge base.</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {items.length === FEEDBACK_PAGE_SIZE && (
        <p className="text-center text-xs text-muted">Showing the {FEEDBACK_PAGE_SIZE} most recent.</p>
      )}
    </div>
  );
}
