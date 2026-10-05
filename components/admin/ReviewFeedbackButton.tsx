"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ReviewFeedbackButton({ id, reviewed }: { id: string; reviewed: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    setBusy(true);
    const res = await fetch(`/api/admin/feedback/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewed: !reviewed }),
    });
    setBusy(false);
    if (res.ok) router.refresh();
    else alert("Could not update the feedback");
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`rounded-lg px-3 py-1 text-sm disabled:opacity-50 ${
        reviewed
          ? "border border-border hover:bg-foreground/5"
          : "bg-brand font-medium text-brand-foreground hover:opacity-90"
      }`}
    >
      {reviewed ? "Reopen" : "Mark reviewed"}
    </button>
  );
}
