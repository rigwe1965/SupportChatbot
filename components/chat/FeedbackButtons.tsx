"use client";

import { useState } from "react";
import type { FeedbackRating } from "@/types";

const MAX_COMMENT = 500;

export default function FeedbackButtons({
  messageId,
  initialRating,
  initialComment,
}: {
  messageId: string;
  initialRating?: FeedbackRating | null;
  initialComment?: string | null;
}) {
  const [rating, setRating] = useState<FeedbackRating | null>(initialRating ?? null);
  const [comment, setComment] = useState(initialComment ?? "");
  const [askReason, setAskReason] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function save(next: FeedbackRating | null, text: string | null) {
    setBusy(true);
    setError(false);
    const res = await fetch(`/api/messages/${messageId}/feedback`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating: next, comment: text }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(true);
      return false;
    }
    return true;
  }

  async function onRate(next: FeedbackRating) {
    if (busy) return;
    const target = rating === next ? null : next; // clicking the active button clears it
    const previous = rating;
    setRating(target);
    setAskReason(target === "DOWN");
    if (target !== "DOWN") setComment("");
    if (!(await save(target, null))) {
      setRating(previous);
      setAskReason(false);
    }
  }

  async function sendReason() {
    const text = comment.trim();
    if (!text) return setAskReason(false);
    if (await save("DOWN", text)) {
      setAskReason(false);
    }
  }

  const button = (value: FeedbackRating, label: string, icon: string) => (
    <button
      type="button"
      onClick={() => onRate(value)}
      disabled={busy}
      aria-pressed={rating === value}
      aria-label={label}
      title={label}
      className={`rounded-md px-1.5 py-0.5 text-sm transition hover:bg-foreground/10 disabled:opacity-50 ${
        rating === value ? "bg-foreground/10" : "opacity-60 hover:opacity-100"
      }`}
    >
      <span aria-hidden>{icon}</span>
    </button>
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1 text-xs text-muted">
        <span className="mr-1">Was this helpful?</span>
        {button("UP", "Helpful", "👍")}
        {button("DOWN", "Not helpful", "👎")}
        {rating && !askReason && !error && (
          <span role="status" className="ml-2">
            Thanks for your feedback!
          </span>
        )}
        {error && (
          <span role="alert" className="ml-2">
            Couldn&apos;t save your feedback. Please try again.
          </span>
        )}
      </div>

      {askReason && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendReason();
          }}
          className="flex flex-wrap items-center gap-2"
        >
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={MAX_COMMENT}
            placeholder="What went wrong? (optional)"
            aria-label="What went wrong?"
            autoFocus
            className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-brand"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground hover:opacity-90 disabled:opacity-50"
          >
            Send
          </button>
          <button
            type="button"
            onClick={() => setAskReason(false)}
            className="text-xs text-muted hover:text-foreground"
          >
            Skip
          </button>
        </form>
      )}
    </div>
  );
}
