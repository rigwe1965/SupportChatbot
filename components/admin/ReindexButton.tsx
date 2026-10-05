"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Regenerates embeddings for one article (pass `id`) or all of them. */
export default function ReindexButton({ id }: { id?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function onClick() {
    if (!id && !confirm("Regenerate embeddings for ALL articles? This uses OpenAI credits.")) return;
    setBusy(true);
    setMessage(null);
    const res = await fetch(id ? `/api/admin/articles/${id}/reindex` : "/api/admin/articles/reindex", {
      method: "POST",
    });
    const json = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      setMessage(json?.error ?? "Failed");
      return;
    }
    if (!id) setMessage(`Reindexed ${json.data.reindexed}${json.data.failed ? `, ${json.data.failed} failed` : ""}`);
    router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className={
          id
            ? "text-sm text-muted hover:text-foreground disabled:opacity-50"
            : "inline-flex h-9 items-center rounded-lg border border-border px-3 text-sm hover:bg-foreground/5 disabled:opacity-50"
        }
      >
        {busy ? "Working…" : id ? "Re-embed" : "Regenerate all embeddings"}
      </button>
      {message && (
        <span role="status" className="text-xs text-muted">
          {message}
        </span>
      )}
    </span>
  );
}
