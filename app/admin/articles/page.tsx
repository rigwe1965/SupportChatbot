import Link from "next/link";
import { requireAdminPage } from "@/lib/admin-page";
import { db } from "@/lib/db";
import DeleteArticleButton from "@/components/DeleteArticleButton";
import ReindexButton from "@/components/admin/ReindexButton";

export default async function ArticlesPage() {
  await requireAdminPage("/admin/articles");
  const articles = await db.article.findMany({
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { chunks: true } } },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight">Knowledge base</h1>
        <div className="flex flex-wrap items-center gap-2">
          {articles.length > 0 && <ReindexButton />}
          <Link
            href="/admin/articles/new"
            className="inline-flex h-9 items-center rounded-lg bg-brand px-3 text-sm font-medium text-brand-foreground hover:opacity-90"
          >
            New article
          </Link>
        </div>
      </div>
      {articles.length === 0 ? (
        <p className="text-muted">No articles yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {articles.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 p-4">
              <div className="min-w-0 flex-1">
                <Link href={`/admin/articles/${a.id}`} className="font-medium hover:text-brand">
                  {a.title}
                </Link>
                <p className="truncate text-sm text-muted">
                  {a.category}
                  {a.tags.length > 0 && ` · ${a.tags.join(", ")}`} · {a._count.chunks}{" "}
                  {a._count.chunks === 1 ? "chunk" : "chunks"}
                </p>
              </div>
              <div className="flex items-center gap-4">
                <Link href={`/admin/articles/${a.id}`} className="text-sm text-muted hover:text-foreground">
                  Edit
                </Link>
                <ReindexButton id={a.id} />
                <DeleteArticleButton id={a.id} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
