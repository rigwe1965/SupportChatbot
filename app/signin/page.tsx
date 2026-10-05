"use client";

import { Suspense } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";

function SignInForm() {
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") ?? "/dashboard";
  const error = params.get("error");

  return (
    <div className="mx-auto max-w-sm space-y-6 rounded-xl border border-border p-6">
      <div className="space-y-1 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Sign in</h1>
        <p className="text-sm text-muted">Continue with your account</p>
      </div>
      {error && (
        <p role="alert" className="rounded-lg border border-border bg-foreground/5 p-3 text-sm">
          Sign-in failed. Please try again.
        </p>
      )}
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
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}
