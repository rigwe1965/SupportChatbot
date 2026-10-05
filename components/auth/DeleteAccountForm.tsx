"use client";

import { signOut } from "next-auth/react";
import { useState } from "react";
import { Notice, fieldClass } from "@/components/auth/AuthCard";

export default function DeleteAccountForm({ needsPassword }: { needsPassword: boolean }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/account/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, confirm }),
    }).catch(() => null);
    if (res?.ok) {
      // Clears the session cookie on this device and leaves the now-dead page.
      await signOut({ callbackUrl: "/" });
      return;
    }
    setBusy(false);
    setError((await res?.json().catch(() => null))?.error ?? "Something went wrong. Please try again.");
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
      <label className="block space-y-1 text-sm">
        <span>
          Type <strong>DELETE</strong> to confirm
        </span>
        <input
          type="text"
          autoComplete="off"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className={fieldClass}
        />
      </label>
      <button
        type="submit"
        disabled={busy || confirm !== "DELETE" || (needsPassword && !password)}
        className="h-10 w-full rounded-lg bg-red-600 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "Deleting…" : "Permanently delete my account"}
      </button>
    </form>
  );
}
