import Link from "next/link";
import { requireAdminPage } from "@/lib/admin-page";
import { db } from "@/lib/db";
import DeleteArticleButton from "@/components/DeleteArticleButton";

export default async function ArticlesPage() {
  await requireAdminPage("/admin/articles");
  const articles = await db.article.findMany({ orderBy: { updatedAt: "desc" } });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-tight">Knowledge base</h1>
        <Link
          href="/admin/articles/new"
          className="inline-flex h-9 items-center rounded-lg bg-brand px-3 text-sm font-medium text-brand-foreground hover:opacity-90"
        >
          New article
        </Link>
      </div>
      {articles.length === 0 ? (
        <p className="text-muted">No articles yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {articles.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-4 p-4">
              <div className="min-w-0">
                <Link href={`/admin/articles/${a.id}`} className="font-medium hover:text-brand">
                  {a.title}
                </Link>
                <p className="truncate text-sm text-muted">
                  {a.category}
                  {a.tags.length > 0 && ` · ${a.tags.join(", ")}`}
                </p>
              </div>
              <DeleteArticleButton id={a.id} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
