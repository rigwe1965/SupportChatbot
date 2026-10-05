import type { EscalationReason } from "@prisma/client";

/** What notification channels (Slack, email) need to know about a new ticket. */
export interface TicketPayload {
  id: string;
  reason: EscalationReason;
  userName: string | null;
  userEmail: string | null;
  question: string;
  lastAnswer: string | null;
  transcript: { role: string; content: string }[];
}

export const REASON_LABEL: Record<EscalationReason, string> = {
  HUMAN_REQUESTED: "Customer asked for a human",
  LOW_CONFIDENCE: "AI not confident in its answer",
  REPEATED_FAILURES: "AI failed to answer repeatedly",
};

export const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

export const shortTicketId = (id: string) => id.slice(-6);

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
export const isEmail = (s: string) => EMAIL_RE.test(s);
