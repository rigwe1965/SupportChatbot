import { notFound, redirect } from "next/navigation";
import ChatShell from "@/components/chat/ChatShell";
import { getSession } from "@/lib/auth";
import { getConversationMessages, listConversations } from "@/lib/conversations";

export const dynamic = "force-dynamic";

export default async function ChatPage({ params }: { params: { id?: string[] } }) {
  const session = await getSession();
  if (!session) redirect("/signin?callbackUrl=/chat");

  const activeId = params.id?.[0] ?? null;
  const [conversations, messages] = await Promise.all([
    listConversations(session.user.id),
    activeId ? getConversationMessages(activeId, session.user.id) : Promise.resolve([]),
  ]);
  if (!messages) notFound();

  return (
    <ChatShell
      initialConversations={conversations}
      initialConversationId={activeId}
      initialMessages={messages}
    />
  );
}
