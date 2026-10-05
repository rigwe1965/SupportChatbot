"use client";

import { useState } from "react";
import { AuthCard, Notice, TextLink, fieldClass, primaryButton } from "@/components/auth/AuthCard";

export default function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/account/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) return setSentTo(email);
    setError((await res?.json().catch(() => null))?.error ?? "Something went wrong. Please try again.");
  }

  if (sentTo) {
    return (
      <AuthCard title="Check your email">
        <Notice>
          We sent a confirmation link to <strong>{sentTo}</strong>. Open it to finish creating your account. If you
          already have an account, the email will say so.
        </Notice>
        <p className="text-center text-sm text-muted">
          <TextLink href="/signin">Back to sign in</TextLink>
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Create an account" subtitle="Sign up with your email">
      <form onSubmit={onSubmit} className="space-y-4">
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Name (optional)</span>
          <input className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={100} />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Email</span>
          <input type="email" className={fieldClass} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Password</span>
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
        {error && <Notice kind="error">{error}</Notice>}
        <button type="submit" disabled={busy} className={primaryButton}>
          {busy ? "Creating account…" : "Create account"}
        </button>
      </form>
      <p className="text-center text-sm text-muted">
        Already have an account? <TextLink href="/signin">Sign in</TextLink>
      </p>
    </AuthCard>
  );
}
