import { Prisma, type EscalationReason } from "@prisma/client";
import { db } from "@/lib/db";
import { postTicketToSlack } from "@/lib/slack";
import { sendTicketEmail } from "@/lib/ticket-email";

const envNumber = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) ? n : fallback;
};

/** Consecutive low-confidence answers before the conversation is escalated. 1 = escalate on the first miss. */
export const MAX_FAILED_ATTEMPTS = Math.max(1, envNumber(process.env.ESCALATION_MAX_FAILED_ATTEMPTS, 2));
/** Best-match cosine similarity below this counts as "not confident". */
export const CONFIDENCE_THRESHOLD = envNumber(process.env.ESCALATION_MIN_SIMILARITY, 0.35);

// "talk to a human", "I want to speak with someone", "get me an agent", "live agent", "real person"…
// Needs an intent verb or an unambiguous phrase so questions like "contact the support team" don't match.
const INTENT = /\b(talk|speak|chat|connect|transfer|escalate|hand|put|get|need|want|let)\b[^.?!]{0,40}\b(human|person|people|agent|representative|operator|manager|staff|someone)\b/i;
const PHRASE = /\b(live|human|real)\s+(agent|person|support|being|representative)\b/i;

export const wantsHuman = (text: string) => INTENT.test(text) || PHRASE.test(text);

/** Number of low-confidence answers in a row at the end of the conversation. */
export async function countFailedAttempts(conversationId: string): Promise<number> {
  const recent = await db.message.findMany({
    where: { conversationId, role: "assistant" },
    orderBy: { createdAt: "desc" },
    take: MAX_FAILED_ATTEMPTS,
    select: { lowConfidence: true },
  });
  let n = 0;
  for (const m of recent) {
    if (!m.lowConfidence) break;
    n++;
  }
  return n;
}

export const getOpenTicket = (conversationId: string) =>
  db.ticket.findFirst({ where: { conversationId, status: "OPEN" }, select: { id: true } });

export const shortId = (id: string) => id.slice(-6);

interface EscalateInput {
  conversationId: string;
  user: { id: string; name?: string | null; email?: string | null };
  reason: EscalationReason;
}

/** Saves an open ticket (with a snapshot of the conversation) and notifies Slack. Idempotent per conversation. */
export async function escalate({ conversationId, user, reason }: EscalateInput) {
  const messages = await db.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true, createdAt: true },
  });
  const question = messages.find((m) => m.role === "user")?.content ?? "";
  const lastAnswer = [...messages].reverse().find((m) => m.role === "assistant")?.content ?? null;
  const transcript = messages.slice(-50).map((m) => ({
    role: m.role,
    content: m.content,
    at: m.createdAt.toISOString(),
  }));

  let ticket;
  try {
    ticket = await db.ticket.create({
      data: {
        reason,
        question,
        lastAnswer,
        transcript,
        conversationId,
        userId: user.id,
        userName: user.name ?? null,
        userEmail: user.email ?? null,
      },
    });
  } catch (err) {
    // A concurrent request already opened a ticket for this conversation.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const existing = await getOpenTicket(conversationId);
      if (existing) return existing;
    }
    throw err;
  }

  // The ticket is already saved; a Slack or email outage must not fail the escalation.
  // Both senders swallow their own errors and report success as a boolean.
  const payload = {
    id: ticket.id,
    reason,
    userName: ticket.userName,
    userEmail: ticket.userEmail,
    question,
    lastAnswer,
    transcript,
  };
  const [slackOk, emailOk] = await Promise.all([postTicketToSlack(payload), sendTicketEmail(payload)]);
  if (slackOk || emailOk) {
    const now = new Date();
    await db.ticket.update({
      where: { id: ticket.id },
      data: { ...(slackOk && { slackPostedAt: now }), ...(emailOk && { emailSentAt: now }) },
    });
  }
  return ticket;
}
