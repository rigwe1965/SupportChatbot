"use client";

import { useState } from "react";
import { Notice, TextLink, primaryButton } from "@/components/auth/AuthCard";

export default function VerifyEmailButton({ token }: { token: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setState("busy");
    setError(null);
    const res = await fetch("/api/account/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }).catch(() => null);
    if (res?.ok) return setState("done");
    setState("idle");
    setError((await res?.json().catch(() => null))?.error ?? "Something went wrong. Please try again.");
  }

  if (state === "done") {
    return (
      <>
        <Notice>Your email is confirmed. You can sign in now.</Notice>
        <p className="text-center text-sm">
          <TextLink href="/signin">Go to sign in</TextLink>
        </p>
      </>
    );
  }

  return (
    <div className="space-y-4">
      {error && <Notice kind="error">{error}</Notice>}
      <button type="button" onClick={onClick} disabled={state === "busy"} className={primaryButton}>
        {state === "busy" ? "Confirming…" : "Confirm my email"}
      </button>
    </div>
  );
}
