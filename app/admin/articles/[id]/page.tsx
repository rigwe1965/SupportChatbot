import { notFound } from "next/navigation";
import { requireAdminPage } from "@/lib/admin-page";
import { db } from "@/lib/db";
import ArticleForm from "@/components/ArticleForm";

export default async function EditArticlePage({ params }: { params: { id: string } }) {
  await requireAdminPage(`/admin/articles/${params.id}`);
  const article = await db.article.findUnique({ where: { id: params.id } });
  if (!article) notFound();

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Edit article</h1>
      <ArticleForm
        articleId={article.id}
        initial={{
          title: article.title,
          content: article.content,
          category: article.category,
          tags: article.tags,
        }}
      />
    </div>
  );
}
