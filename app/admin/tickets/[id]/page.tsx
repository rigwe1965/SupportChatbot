import Link from "next/link";
import { notFound } from "next/navigation";
import ResolveTicketButton from "@/components/ResolveTicketButton";
import { requireAdminPage } from "@/lib/admin-page";
import { db } from "@/lib/db";

const REASON_LABEL: Record<string, string> = {
  HUMAN_REQUESTED: "Customer asked for a human",
  LOW_CONFIDENCE: "AI not confident",
  REPEATED_FAILURES: "AI failed repeatedly",
};

type TranscriptMessage = { role: string; content: string; at?: string };

export default async function TicketDetailPage({ params }: { params: { id: string } }) {
  await requireAdminPage(`/admin/tickets/${params.id}`);
  const t = await db.ticket.findUnique({ where: { id: params.id } });
  if (!t) notFound();
  const transcript = t.transcript as TranscriptMessage[];

  return (
    <div className="space-y-6">
      <Link href="/admin/tickets" className="text-sm text-muted hover:text-foreground">
        ← All tickets
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight">Ticket #{t.id.slice(-6)}</h1>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              t.status === "OPEN" ? "bg-brand text-brand-foreground" : "bg-foreground/10 text-muted"
            }`}
          >
            {t.status === "OPEN" ? "Open" : "Resolved"}
          </span>
        </div>
        {t.status === "OPEN" && <ResolveTicketButton id={t.id} />}
      </div>

      <dl className="grid gap-4 rounded-xl border border-border p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-muted">Customer</dt>
          <dd className="font-medium">{t.userName ?? "—"}</dd>
          <dd className="break-all text-muted">{t.userEmail}</dd>
        </div>
        <div>
          <dt className="text-muted">Reason</dt>
          <dd className="font-medium">{REASON_LABEL[t.reason]}</dd>
        </div>
        <div>
          <dt className="text-muted">Opened</dt>
          <dd className="font-medium">{t.createdAt.toLocaleString()}</dd>
        </div>
        <div>
          <dt className="text-muted">Notifications</dt>
          <dd className="font-medium">Slack: {t.slackPostedAt ? "sent" : "not sent"}</dd>
          <dd className="font-medium">Email: {t.emailSentAt ? "sent" : "not sent"}</dd>
          {t.resolvedAt && <dd className="text-muted">Resolved {t.resolvedAt.toLocaleString()}</dd>}
        </div>
      </dl>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-border p-4">
          <h2 className="text-sm font-semibold">Original question</h2>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted">{t.question}</p>
        </div>
        <div className="rounded-xl border border-border p-4">
          <h2 className="text-sm font-semibold">AI&apos;s last answer</h2>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted">{t.lastAnswer ?? "—"}</p>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Conversation</h2>
        <div className="space-y-3 rounded-xl border border-border p-4">
          {transcript.map((m, i) => {
            const isUser = m.role === "user";
            return (
              <div key={i} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-sm sm:max-w-[75%] ${
                    isUser
                      ? "rounded-br-sm bg-brand text-brand-foreground"
                      : "rounded-bl-sm border border-border bg-foreground/[0.03]"
                  }`}
                >
                  {m.content}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
