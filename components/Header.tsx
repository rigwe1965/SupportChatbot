import Link from "next/link";
import ThemeToggle from "./ThemeToggle";
import AuthButton from "./AuthButton";
import { getSession } from "@/lib/auth";

export default async function Header() {
  const session = await getSession();

  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-6">
          <Link href="/" className="font-semibold tracking-tight">
            Support<span className="text-brand">Chatbot</span>
          </Link>
          {session && (
            <nav className="flex items-center gap-4 text-sm text-muted">
              <Link href="/chat" className="hover:text-foreground">
                Chat
              </Link>
              <Link href="/dashboard" className="hover:text-foreground">
                Dashboard
              </Link>
              {session.user.role === "ADMIN" && (
                <Link href="/admin" className="hover:text-foreground">
                  Admin
                </Link>
              )}
            </nav>
          )}
        </div>
        <div className="flex items-center gap-2">
          <AuthButton />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
