import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
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
  "I couldn't find anything about that in our knowledge base. Please contact our support team and they'll be happy to help.";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

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
  if (conversationId) {
    const existing = await db.conversation.findFirst({
      where: { id: conversationId, userId },
      select: { id: true },
    });
    if (!existing) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    const recent = await db.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      take: HISTORY_MESSAGES,
      select: { role: true, content: true },
    });
    history = recent
      .reverse()
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  }

  // Retrieve before persisting anything so a failure leaves no orphaned rows.
  let chunks;
  try {
    chunks = (await retrieve(message, TOP_K)).filter((c) => c.similarity >= MIN_SIMILARITY);
  } catch (err) {
    console.error("retrieval failed", err);
    return NextResponse.json({ error: "Could not search the knowledge base" }, { status: 502 });
  }

  const sources: Source[] = chunks.map((c, i) => ({
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
        data: { userId, title: message.slice(0, 60) },
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

      send({ type: "meta", conversationId: conversation.id, sources });
      try {
        if (chunks.length === 0) {
          answer = NO_ANSWER;
          send({ type: "delta", text: answer });
        } else {
          const llmMessages: LlmMessage[] = [
            {
              role: "system",
              content: buildSystemPrompt(chunks.map((c, i) => ({ ...c, n: i + 1 }))),
            },
            ...history,
            { role: "user", content: message },
          ];
          for await (const text of streamChat(llmMessages, req.signal)) {
            answer += text;
            send({ type: "delta", text });
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
                sources: sources as unknown as Prisma.InputJsonValue,
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
