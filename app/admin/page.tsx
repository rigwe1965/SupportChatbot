import Link from "next/link";
import { ConversationsChart, EscalationChart, TopicsChart } from "@/components/admin/Charts";
import { requireAdminPage } from "@/lib/admin-page";
import { getOverviewStats } from "@/lib/admin-stats";

const RANGES = [7, 30, 90];

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-3xl font-bold tracking-tight">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export default async function AdminOverviewPage({ searchParams }: { searchParams: { days?: string } }) {
  await requireAdminPage("/admin");
  const requested = Number(searchParams.days);
  const days = RANGES.includes(requested) ? requested : 30;
  const s = await getOverviewStats(days);

  const resolutionRate = s.totalTickets ? Math.round((s.resolvedTickets / s.totalTickets) * 100) : null;
  const periodConversations = s.daily.reduce((n, d) => n + d.conversations, 0);
  const periodEscalated = s.daily.reduce((n, d) => n + d.escalated, 0);
  const escalationRate = periodConversations ? Math.round((periodEscalated / periodConversations) * 100) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight">Overview</h1>
        <div className="inline-flex rounded-lg border border-border p-0.5 text-sm" role="group" aria-label="Date range">
          {RANGES.map((r) => (
            <Link
              key={r}
              href={`/admin?days=${r}`}
              aria-current={r === days ? "true" : undefined}
              className={`rounded-md px-3 py-1 ${
                r === days ? "bg-brand text-brand-foreground" : "text-muted hover:text-foreground"
              }`}
            >
              {r}d
            </Link>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total conversations" value={s.totalConversations.toLocaleString()} hint="All time" />
        <StatCard label="Open tickets" value={s.openTickets.toLocaleString()} hint={`${s.totalTickets} total`} />
        <StatCard
          label="Resolution rate"
          value={resolutionRate === null ? "—" : `${resolutionRate}%`}
          hint={`${s.resolvedTickets} of ${s.totalTickets} tickets resolved`}
        />
        <StatCard
          label="Avg response time"
          value={s.avgResponseSeconds === null ? "—" : `${s.avgResponseSeconds.toFixed(1)}s`}
          hint={`AI reply, last ${days} days`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ConversationsChart data={s.daily} />
        <EscalationChart data={s.daily} overall={escalationRate} />
        <div className="lg:col-span-2">
          <TopicsChart data={s.topics} />
        </div>
      </div>
    </div>
  );
}
