"use client";

import { useRouter } from "next/navigation";

export default function DeleteArticleButton({ id }: { id: string }) {
  const router = useRouter();

  async function onClick() {
    if (!confirm("Delete this article and its embeddings?")) return;
    const res = await fetch(`/api/admin/articles/${id}`, { method: "DELETE" });
    if (res.ok) router.refresh();
    else alert("Could not delete the article");
  }

  return (
    <button type="button" onClick={onClick} className="text-sm text-muted hover:text-foreground">
      Delete
    </button>
  );
}
