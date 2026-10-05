"use client";

import { useState } from "react";
import { Notice, TextLink, fieldClass, primaryButton } from "@/components/auth/AuthCard";

export default function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError("The passwords don't match");
    setBusy(true);
    setError(null);
    const res = await fetch("/api/account/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) return setDone(true);
    setError((await res?.json().catch(() => null))?.error ?? "Something went wrong. Please try again.");
  }

  if (done) {
    return (
      <>
        <Notice>Your password has been changed. You can now sign in.</Notice>
        <p className="text-center text-sm">
          <TextLink href="/signin">Go to sign in</TextLink>
        </p>
      </>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block space-y-1 text-sm">
        <span className="font-medium">New password</span>
        <input
          type="password"
          className={fieldClass}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
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
      {error && <Notice kind="error">{error}</Notice>}
      <button type="submit" disabled={busy} className={primaryButton}>
        {busy ? "Saving…" : "Change password"}
      </button>
    </form>
  );
}
