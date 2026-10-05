import Link from "next/link";
import { requireAdminPage } from "@/lib/admin-page";
import { AUDIT_CATEGORIES, listAudit, parseAuditCategory } from "@/lib/audit";

const ACTION_LABEL: Record<string, string> = {
  "article.create": "Article created",
  "article.update": "Article updated",
  "article.delete": "Article deleted",
  "article.reindex": "Embeddings regenerated",
  "article.reindex_all": "All embeddings regenerated",
  "ticket.resolve": "Ticket resolved",
  "feedback.review": "Feedback reviewed",
  "feedback.reopen": "Feedback reopened",
  "feedback.export": "Feedback exported",
  "user.promoted_admin": "Admin promotion",
};

export default async function AuditPage({ searchParams }: { searchParams: { category?: string; page?: string } }) {
  await requireAdminPage("/admin/audit");
  const category = parseAuditCategory(searchParams.category);
  const page = Math.max(1, Number.parseInt(searchParams.page ?? "1", 10) || 1);
  const { entries, hasMore } = await listAudit(category, page);

  const href = (c: string, p: number) => `/admin/audit?category=${c}${p > 1 ? `&page=${p}` : ""}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Audit log</h1>
          <p className="text-sm text-muted">Who did what in the admin area, newest first</p>
        </div>
        <div className="inline-flex flex-wrap rounded-lg border border-border p-0.5 text-sm" role="group" aria-label="Category">
          {AUDIT_CATEGORIES.map((c) => (
            <Link
              key={c.key}
              href={href(c.key, 1)}
              aria-current={c.key === category ? "true" : undefined}
              className={`rounded-md px-3 py-1 ${
                c.key === category ? "bg-brand text-brand-foreground" : "text-muted hover:text-foreground"
              }`}
            >
              {c.label}
            </Link>
          ))}
        </div>
      </div>

      {entries.length === 0 ? (
        <p className="text-muted">{page > 1 ? "No more entries." : "Nothing logged yet."}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <thead className="border-b border-border text-muted">
              <tr>
                <th className="p-3 font-medium">When</th>
                <th className="p-3 font-medium">Admin</th>
                <th className="p-3 font-medium">Action</th>
                <th className="p-3 font-medium">Details</th>
                <th className="p-3 font-medium">IP</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b border-border align-top last:border-0">
                  <td className="whitespace-nowrap p-3 text-muted">{e.createdAt.toLocaleString()}</td>
                  <td className="p-3">{e.actorEmail ?? <span className="text-muted">Unknown</span>}</td>
                  <td className="whitespace-nowrap p-3 font-medium">{ACTION_LABEL[e.action] ?? e.action}</td>
                  <td className="p-3">
                    <p className="break-words">{e.summary}</p>
                    {e.targetId && (
                      <p className="mt-0.5 font-mono text-xs text-muted">
                        {e.targetType} {e.targetId}
                      </p>
                    )}
                  </td>
                  <td className="whitespace-nowrap p-3 font-mono text-xs text-muted">{e.ip ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(page > 1 || hasMore) && (
        <div className="flex items-center justify-between text-sm">
          {page > 1 ? (
            <Link href={href(category, page - 1)} className="text-brand hover:underline">
              ← Newer
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted">Page {page}</span>
          {hasMore ? (
            <Link href={href(category, page + 1)} className="text-brand hover:underline">
              Older →
            </Link>
          ) : (
            <span />
          )}
        </div>
      )}
    </div>
  );
}
