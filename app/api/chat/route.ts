import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  CONFIDENCE_THRESHOLD,
  MAX_FAILED_ATTEMPTS,
  countFailedAttempts,
  escalate,
  getOpenTicket,
  shortId,
  wantsHuman,
} from "@/lib/escalation";
import { retrieve } from "@/lib/knowledge";
import { streamChat, type LlmMessage } from "@/lib/openai-chat";
import { buildSystemPrompt } from "@/lib/prompt";
import type { ChatStreamEvent, Source } from "@/types";

export const dynamic = "force-dynamic";

const MAX_MESSAGE_CHARS = 4000;
const HISTORY_MESSAGES = 10;
const TOP_K = 5;
// Chunks below this cosine similarity are treated as unrelated to the question.
const MIN_SIMILARITY = 0.25;
const NO_ANSWER =
  "I couldn't find anything about that in our knowledge base. Could you rephrase or add more detail? If I still can't help, I'll pass you to our support team.";

const escalatedReply = (human: boolean, id: string) =>
  human
    ? `Of course — I'm connecting you with a member of our support team. I've shared this conversation with them (ticket #${shortId(id)}) and a human will take over from here. They'll follow up with you soon.`
    : `I'm sorry I haven't been able to help with this. I've passed your conversation to our support team (ticket #${shortId(id)}) and a human will take over. They'll follow up with you soon.`;

const pausedReply = (id: string) =>
  `A member of our support team is already handling your request (ticket #${shortId(id)}) and will follow up with you soon. If you have a different question, you can start a new chat.`;

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = session.user;

  const body = await req.json().catch(() => null);
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  const conversationId = typeof body?.conversationId === "string" ? body.conversationId : null;
  if (!message || message.length > MAX_MESSAGE_CHARS) {
    return NextResponse.json(
      { error: `Message is required (max ${MAX_MESSAGE_CHARS} characters)` },
      { status: 400 },
    );
  }

  // Existing conversations must belong to the caller.
  let history: LlmMessage[] = [];
  let openTicketId: string | null = null;
  let priorFailures = 0;
  if (conversationId) {
    const existing = await db.conversation.findFirst({
      where: { id: conversationId, userId: user.id },
      select: { id: true },
    });
    if (!existing) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    const [recent, openTicket, failures] = await Promise.all([
      db.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: "desc" },
        take: HISTORY_MESSAGES,
        select: { role: true, content: true },
      }),
      getOpenTicket(conversationId),
      countFailedAttempts(conversationId),
    ]);
    history = recent
      .reverse()
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
    openTicketId = openTicket?.id ?? null;
    priorFailures = failures;
  }

  // Retrieve before persisting anything so a failure leaves no orphaned rows.
  // Skipped when a human already owns the conversation (saves an embedding call).
  let chunks: Awaited<ReturnType<typeof retrieve>> = [];
  if (!openTicketId) {
    try {
      chunks = await retrieve(message, TOP_K);
    } catch (err) {
      console.error("retrieval failed", err);
      return NextResponse.json({ error: "Could not search the knowledge base" }, { status: 502 });
    }
  }

  const topSimilarity = chunks[0]?.similarity ?? 0;
  const lowConfidence = !openTicketId && topSimilarity < CONFIDENCE_THRESHOLD;
  const humanRequested = !openTicketId && wantsHuman(message);
  const failedAttempts = lowConfidence ? priorFailures + 1 : 0;
  const shouldEscalate = humanRequested || failedAttempts >= MAX_FAILED_ATTEMPTS;

  const relevant = chunks.filter((c) => c.similarity >= MIN_SIMILARITY);
  const sources: Source[] = relevant.map((c, i) => ({
    n: i + 1,
    articleId: c.articleId,
    title: c.title,
    category: c.category,
    snippet: c.content.length > 300 ? `${c.content.slice(0, 300)}…` : c.content,
    similarity: c.similarity,
  }));

  const conversation = conversationId
    ? { id: conversationId }
    : await db.conversation.create({
        data: { userId: user.id, title: message.slice(0, 60) },
        select: { id: true },
      });
  await db.message.create({
    data: { conversationId: conversation.id, role: "user", content: message },
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: ChatStreamEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
      let answer = "";
      let answerSources: Source[] = [];
      let answerLowConfidence = false;

      try {
        if (openTicketId) {
          send({ type: "meta", conversationId: conversation.id, sources: [] });
          send({ type: "escalated", ticketId: openTicketId });
          answer = pausedReply(openTicketId);
          send({ type: "delta", text: answer });
        } else if (shouldEscalate) {
          send({ type: "meta", conversationId: conversation.id, sources: [] });
          const ticket = await escalate({
            conversationId: conversation.id,
            user,
            reason: humanRequested
              ? "HUMAN_REQUESTED"
              : MAX_FAILED_ATTEMPTS > 1
                ? "REPEATED_FAILURES"
                : "LOW_CONFIDENCE",
          });
          send({ type: "escalated", ticketId: ticket.id });
          answer = escalatedReply(humanRequested, ticket.id);
          send({ type: "delta", text: answer });
        } else {
          answerSources = sources;
          answerLowConfidence = lowConfidence;
          send({ type: "meta", conversationId: conversation.id, sources });
          if (relevant.length === 0) {
            answer = NO_ANSWER;
            send({ type: "delta", text: answer });
          } else {
            const llmMessages: LlmMessage[] = [
              {
                role: "system",
                content: buildSystemPrompt(relevant.map((c, i) => ({ ...c, n: i + 1 }))),
              },
              ...history,
              { role: "user", content: message },
            ];
            for await (const text of streamChat(llmMessages, req.signal)) {
              answer += text;
              send({ type: "delta", text });
            }
          }
        }
        send({ type: "done" });
      } catch (err) {
        if (!req.signal.aborted) {
          console.error("chat stream failed", err);
          send({ type: "error", message: "The assistant ran into a problem. Please try again." });
        }
      } finally {
        // Keep whatever was generated, even if the user stopped it early.
        if (answer) {
          await db.message
            .create({
              data: {
                conversationId: conversation.id,
                role: "assistant",
                content: answer,
                sources: answerSources as unknown as Prisma.InputJsonValue,
                lowConfidence: answerLowConfidence,
              },
            })
            .catch((e) => console.error("saving reply failed", e));
        }
        await db.conversation
          .update({ where: { id: conversation.id }, data: { updatedAt: new Date() } })
          .catch(() => {});
        try {
          controller.close();
        } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
