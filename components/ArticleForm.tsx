"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ArticleInput } from "@/types";

const field =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand";

export default function ArticleForm({
  articleId,
  initial,
}: {
  articleId?: string;
  initial?: ArticleInput;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [tags, setTags] = useState(initial?.tags.join(", ") ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setContent(await file.text());
    if (!title) setTitle(file.name.replace(/\.[^.]+$/, ""));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await fetch(articleId ? `/api/admin/articles/${articleId}` : "/api/admin/articles", {
      method: articleId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        category,
        content,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      }),
    });
    if (res.ok) {
      router.push("/admin/articles");
      router.refresh();
      return;
    }
    setError((await res.json().catch(() => null))?.error ?? "Something went wrong");
    setSaving(false);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="font-medium">Title</span>
          <input className={field} value={title} onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Category</span>
          <input className={field} value={category} onChange={(e) => setCategory(e.target.value)} required />
        </label>
      </div>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">Tags (comma-separated)</span>
        <input className={field} value={tags} onChange={(e) => setTags(e.target.value)} />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">Content</span>
        <textarea
          className={`${field} min-h-64 font-mono`}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          required
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">Or load from a file (.md / .txt)</span>
        <input type="file" accept=".md,.txt,text/plain,text/markdown" onChange={onFile} className="block text-sm" />
      </label>
      {error && (
        <p role="alert" className="rounded-lg border border-border bg-foreground/5 p-3 text-sm">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={saving}
        className="h-10 rounded-lg bg-brand px-4 text-sm font-medium text-brand-foreground transition hover:opacity-90 disabled:opacity-50"
      >
        {saving ? "Saving & embedding…" : articleId ? "Save changes" : "Create article"}
      </button>
    </form>
  );
}
