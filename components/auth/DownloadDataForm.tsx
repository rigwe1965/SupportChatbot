"use client";

import { useState } from "react";
import { Notice, fieldClass } from "@/components/auth/AuthCard";

export default function DownloadDataForm({ needsPassword }: { needsPassword: boolean }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/account/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    }).catch(() => null);
    setBusy(false);

    if (!res?.ok) {
      return setError((await res?.json().catch(() => null))?.error ?? "Something went wrong. Please try again.");
    }
    const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "my-data.json";
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    a.click();
    URL.revokeObjectURL(url);
    setPassword("");
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && <Notice kind="error">{error}</Notice>}
      {needsPassword && (
        <label className="block space-y-1 text-sm">
          <span>Your password</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={fieldClass}
          />
        </label>
      )}
      <button
        type="submit"
        disabled={busy || (needsPassword && !password)}
        className="h-10 w-full rounded-lg bg-brand text-sm font-medium text-brand-foreground transition hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "Preparing…" : "Download my data"}
      </button>
    </form>
  );
}
