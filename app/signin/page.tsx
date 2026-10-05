"use client";

import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthCard, Notice, TextLink, fieldClass, primaryButton } from "@/components/auth/AuthCard";

const ERRORS: Record<string, string> = {
  CredentialsSignin: "Incorrect email or password.",
  EmailNotVerified: "Please confirm your email first. Check your inbox for the confirmation link.",
  RateLimited: "Too many attempts. Please wait a few minutes and try again.",
};

function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") ?? "/dashboard";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(
    params.get("error") ? "Sign-in failed. Please try again." : null,
  );
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await signIn("credentials", { email, password, redirect: false, callbackUrl });
    setBusy(false);
    if (res?.ok && !res.error) {
      router.push(callbackUrl);
      router.refresh();
      return;
    }
    setError(ERRORS[res?.error ?? ""] ?? "Sign-in failed. Please try again.");
  }

  return (
    <AuthCard title="Sign in" subtitle="Continue with your account">
      <form onSubmit={onSubmit} className="space-y-4">
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
            autoComplete="current-password"
            required
          />
        </label>
        {error && <Notice kind="error">{error}</Notice>}
        <button type="submit" disabled={busy} className={primaryButton}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p className="text-center text-sm">
          <TextLink href="/forgot-password">Forgot password?</TextLink>
        </p>
      </form>

      <div className="flex items-center gap-3 text-xs text-muted">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>

      <div className="space-y-3">
        <button
          type="button"
          onClick={() => signIn("google", { callbackUrl })}
          className="h-10 w-full rounded-lg border border-border text-sm font-medium transition hover:bg-foreground/5"
        >
          Continue with Google
        </button>
        <button
          type="button"
          onClick={() => signIn("github", { callbackUrl })}
          className="h-10 w-full rounded-lg border border-border text-sm font-medium transition hover:bg-foreground/5"
        >
          Continue with GitHub
        </button>
      </div>

      <p className="text-center text-sm text-muted">
        New here? <TextLink href="/register">Create an account</TextLink>
      </p>
    </AuthCard>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}
