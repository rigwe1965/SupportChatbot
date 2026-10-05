"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ResolveTicketButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    setBusy(true);
    const res = await fetch(`/api/admin/tickets/${id}`, { method: "PATCH" });
    setBusy(false);
    if (res.ok) router.refresh();
    else alert("Could not resolve the ticket");
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="rounded-lg border border-border px-3 py-1 text-sm hover:bg-foreground/5 disabled:opacity-50"
    >
      Mark resolved
    </button>
  );
}
