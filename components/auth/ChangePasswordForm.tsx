"use client";

import { useState } from "react";
import { Notice, fieldClass, primaryButton } from "@/components/auth/AuthCard";

export default function ChangePasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setDone(false);
    if (next !== confirm) return setError("The new passwords don't match");
    setBusy(true);
    setError(null);
    const res = await fetch("/api/account/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: current, newPassword: next }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      setCurrent("");
      setNext("");
      setConfirm("");
      return setDone(true);
    }
    setError((await res?.json().catch(() => null))?.error ?? "Something went wrong. Please try again.");
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {done && <Notice>Your password has been changed.</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      <label className="block space-y-1 text-sm">
        <span className="font-medium">Current password</span>
        <input
          type="password"
          className={fieldClass}
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
          required
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">New password</span>
        <input
          type="password"
          className={fieldClass}
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
          minLength={10}
          maxLength={128}
          required
        />
        <span className="text-xs text-muted">At least 10 characters.</span>
      </label>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">Confirm new password</span>
        <input
          type="password"
          className={fieldClass}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          required
        />
      </label>
      <button type="submit" disabled={busy} className={primaryButton}>
        {busy ? "Saving…" : "Change password"}
      </button>
    </form>
  );
}
