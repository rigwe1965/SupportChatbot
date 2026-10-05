import { db } from "@/lib/db";
import type { ChatMessage, ConversationSummary, Source } from "@/types";

export async function listConversations(userId: string): Promise<ConversationSummary[]> {
  const rows = await db.conversation.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: { id: true, title: true, updatedAt: true },
  });
  return rows.map((c) => ({ ...c, updatedAt: c.updatedAt.toISOString() }));
}

/** Returns the messages of a conversation the user owns, or null if it isn't theirs. */
export async function getConversationMessages(
  id: string,
  userId: string,
): Promise<ChatMessage[] | null> {
  const conv = await db.conversation.findFirst({
    where: { id, userId },
    select: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!conv) return null;
  return conv.messages.map((m) => ({
    id: m.id,
    role: m.role as ChatMessage["role"],
    content: m.content,
    sources: (m.sources as unknown as Source[] | null) ?? undefined,
  }));
}
