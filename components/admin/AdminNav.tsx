"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/admin", label: "Overview", exact: true },
  { href: "/admin/tickets", label: "Tickets" },
  { href: "/admin/articles", label: "Knowledge base" },
  { href: "/admin/users", label: "Users" },
];

export default function AdminNav({ openTickets }: { openTickets: number }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Admin" className="-mx-4 overflow-x-auto border-b border-border px-4 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-1">
        {links.map((l) => {
          const active = l.exact ? pathname === l.href : pathname.startsWith(l.href);
          return (
            <li key={l.href}>
              <Link
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm transition ${
                  active
                    ? "border-brand font-medium text-foreground"
                    : "border-transparent text-muted hover:text-foreground"
                }`}
              >
                {l.label}
                {l.href === "/admin/tickets" && openTickets > 0 && (
                  <span className="rounded-full bg-brand px-1.5 text-xs font-medium text-brand-foreground">
                    {openTickets}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
