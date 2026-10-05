"use client";

import { signOut } from "next-auth/react";
import { useState } from "react";
import { Notice } from "@/components/auth/AuthCard";

export default function SignOutEverywhereButton() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onClick() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/account/sign-out-everywhere", { method: "POST" }).catch(() => null);
    if (res?.ok) {
      // Clears the cookie on this device too; every other device is rejected on its next request.
      await signOut({ callbackUrl: "/signin" });
      return;
    }
    setBusy(false);
    setError((await res?.json().catch(() => null))?.error ?? "Something went wrong. Please try again.");
  }

  return (
    <div className="space-y-3">
      {error && <Notice kind="error">{error}</Notice>}
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="h-10 w-full rounded-lg border border-border text-sm font-medium transition hover:bg-foreground/5 disabled:opacity-50"
      >
        {busy ? "Signing out…" : "Sign out everywhere"}
      </button>
    </div>
  );
}
