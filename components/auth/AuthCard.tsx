import Link from "next/link";

export const fieldClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand";

export const primaryButton =
  "h-10 w-full rounded-lg bg-brand text-sm font-medium text-brand-foreground transition hover:opacity-90 disabled:opacity-50";

export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-sm space-y-6 rounded-xl border border-border p-6">
      <div className="space-y-1 text-center">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

export function Notice({ children, kind = "info" }: { children: React.ReactNode; kind?: "info" | "error" }) {
  return (
    <p
      role={kind === "error" ? "alert" : "status"}
      className="rounded-lg border border-border bg-foreground/5 p-3 text-sm"
    >
      {children}
    </p>
  );
}

export function TextLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-brand hover:underline">
      {children}
    </Link>
  );
}
