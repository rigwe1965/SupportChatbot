"use client";

import Link from "next/link";
import { signOut, useSession } from "next-auth/react";

export default function AuthButton() {
  const { data: session, status } = useSession();

  if (status === "loading") return <div className="h-9 w-20" />;

  if (!session) {
    return (
      <Link
        href="/signin"
        className="inline-flex h-9 items-center rounded-lg bg-brand px-3 text-sm font-medium text-brand-foreground transition hover:opacity-90"
      >
        Sign in
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-3">
      {session.user.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={session.user.image}
          alt=""
          className="hidden h-8 w-8 rounded-full sm:block"
        />
      )}
      <Link href="/account" className="hidden text-sm hover:underline sm:block">
        {session.user.name ?? session.user.email}
      </Link>
      <button
        type="button"
        onClick={() => signOut({ callbackUrl: "/" })}
        className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-sm transition hover:bg-foreground/5"
      >
        Sign out
      </button>
    </div>
  );
}
