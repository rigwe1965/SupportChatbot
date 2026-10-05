"use client";

import { useState } from "react";
import { AuthCard, Notice, TextLink, fieldClass, primaryButton } from "@/components/auth/AuthCard";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/account/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) return setSent(true);
    setError((await res?.json().catch(() => null))?.error ?? "Something went wrong. Please try again.");
  }

  return (
    <AuthCard title="Forgot your password?" subtitle="We'll email you a link to choose a new one">
      {sent ? (
        <Notice>
          If an account exists for <strong>{email}</strong>, a reset link is on its way. It works for 1 hour.
        </Notice>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block space-y-1 text-sm">
            <span className="font-medium">Email</span>
            <input type="email" className={fieldClass} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          </label>
          {error && <Notice kind="error">{error}</Notice>}
          <button type="submit" disabled={busy} className={primaryButton}>
            {busy ? "Sending…" : "Send reset link"}
          </button>
        </form>
      )}
      <p className="text-center text-sm text-muted">
        <TextLink href="/signin">Back to sign in</TextLink>
      </p>
    </AuthCard>
  );
}
