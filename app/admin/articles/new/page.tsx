import { requireAdminPage } from "@/lib/admin-page";
import ArticleForm from "@/components/ArticleForm";

export default async function NewArticlePage() {
  await requireAdminPage("/admin/articles/new");
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">New article</h1>
      <ArticleForm />
    </div>
  );
}
