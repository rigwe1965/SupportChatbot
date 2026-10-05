import Link from "next/link";
import { requireAdminPage } from "@/lib/admin-page";
import { db } from "@/lib/db";

const REASON_LABEL: Record<string, string> = {
  HUMAN_REQUESTED: "Asked for a human",
  LOW_CONFIDENCE: "Low confidence",
  REPEATED_FAILURES: "Repeated failures",
};

const FILTERS = [
  { key: "open", label: "Open" },
  { key: "resolved", label: "Closed" },
  { key: "all", label: "All" },
] as const;

export default async function TicketsPage({ searchParams }: { searchParams: { status?: string } }) {
  await requireAdminPage("/admin/tickets");
  const filter = FILTERS.find((f) => f.key === searchParams.status)?.key ?? "open";
  const tickets = await db.ticket.findMany({
    where: filter === "all" ? {} : { status: filter === "open" ? "OPEN" : "RESOLVED" },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight">Support tickets</h1>
        <div className="inline-flex rounded-lg border border-border p-0.5 text-sm" role="group" aria-label="Status">
          {FILTERS.map((f) => (
            <Link
              key={f.key}
              href={`/admin/tickets?status=${f.key}`}
              aria-current={f.key === filter ? "true" : undefined}
              className={`rounded-md px-3 py-1 ${
                f.key === filter ? "bg-brand text-brand-foreground" : "text-muted hover:text-foreground"
              }`}
            >
              {f.label}
            </Link>
          ))}
        </div>
      </div>

      {tickets.length === 0 ? (
        <p className="text-muted">No {filter === "all" ? "" : filter === "open" ? "open " : "closed "}tickets.</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {tickets.map((t) => (
            <li key={t.id}>
              <Link href={`/admin/tickets/${t.id}`} className="block space-y-1 p-4 hover:bg-foreground/[0.03]">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      t.status === "OPEN" ? "bg-brand text-brand-foreground" : "bg-foreground/10 text-muted"
                    }`}
                  >
                    {t.status === "OPEN" ? "Open" : "Resolved"}
                  </span>
                  <span className="font-medium">#{t.id.slice(-6)}</span>
                  <span className="text-sm text-muted">{REASON_LABEL[t.reason]}</span>
                  {!t.slackPostedAt && !t.emailSentAt && t.status === "OPEN" && (
                    <span className="text-xs text-muted">· Team not notified</span>
                  )}
                  <span className="ml-auto text-xs text-muted">{t.createdAt.toLocaleString()}</span>
                </div>
                <p className="truncate text-sm">{t.question}</p>
                <p className="truncate text-xs text-muted">{t.userName ?? "Unknown"} {t.userEmail && `· ${t.userEmail}`}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
