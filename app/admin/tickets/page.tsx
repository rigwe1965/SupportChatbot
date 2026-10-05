import { requireAdminPage } from "@/lib/admin-page";
import { db } from "@/lib/db";
import ResolveTicketButton from "@/components/ResolveTicketButton";

const REASON: Record<string, string> = {
  HUMAN_REQUESTED: "Asked for a human",
  LOW_CONFIDENCE: "Low confidence",
  REPEATED_FAILURES: "Repeated failures",
};

type TranscriptMessage = { role: string; content: string };

export default async function TicketsPage() {
  await requireAdminPage("/admin/tickets");
  const tickets = await db.ticket.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 100,
  });

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Support tickets</h1>
      {tickets.length === 0 ? (
        <p className="text-muted">No tickets yet.</p>
      ) : (
        <ul className="space-y-3">
          {tickets.map((t) => (
            <li key={t.id}>
              <details className="rounded-xl border border-border">
                <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 p-4">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      t.status === "OPEN" ? "bg-brand text-brand-foreground" : "bg-foreground/10 text-muted"
                    }`}
                  >
                    {t.status === "OPEN" ? "Open" : "Resolved"}
                  </span>
                  <span className="font-medium">#{t.id.slice(-6)}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-muted">
                    {t.userName ?? t.userEmail ?? "Unknown"} · {REASON[t.reason]} ·{" "}
                    {t.createdAt.toLocaleString()}
                  </span>
                  {!t.slackPostedAt && t.status === "OPEN" && (
                    <span className="text-xs text-muted">Slack not sent</span>
                  )}
                </summary>
                <div className="space-y-4 border-t border-border p-4 text-sm">
                  <div>
                    <p className="font-medium">Customer</p>
                    <p className="text-muted">
                      {t.userName ?? "—"} {t.userEmail && `<${t.userEmail}>`}
                    </p>
                  </div>
                  <div>
                    <p className="font-medium">Original question</p>
                    <p className="whitespace-pre-wrap text-muted">{t.question}</p>
                  </div>
                  <div>
                    <p className="font-medium">AI&apos;s last answer</p>
                    <p className="whitespace-pre-wrap text-muted">{t.lastAnswer ?? "—"}</p>
                  </div>
                  <div>
                    <p className="font-medium">Conversation</p>
                    <ul className="mt-1 space-y-1">
                      {(t.transcript as TranscriptMessage[]).map((m, i) => (
                        <li key={i} className="whitespace-pre-wrap text-muted">
                          <span className="font-medium text-foreground">
                            {m.role === "user" ? "Customer" : "AI"}:
                          </span>{" "}
                          {m.content}
                        </li>
                      ))}
                    </ul>
                  </div>
                  {t.status === "OPEN" && <ResolveTicketButton id={t.id} />}
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
