"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import MessageItem from "./MessageItem";
import type { ChatMessage, ChatStreamEvent, ConversationSummary } from "@/types";

interface Props {
  initialConversations: ConversationSummary[];
  initialConversationId: string | null;
  initialMessages: ChatMessage[];
}

const uid = () => crypto.randomUUID();

export default function ChatShell({
  initialConversations,
  initialConversationId,
  initialMessages,
}: Props) {
  const [conversations, setConversations] = useState(initialConversations);
  const [activeId, setActiveId] = useState(initialConversationId);
  const [messages, setMessages] = useState(initialMessages);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [loadingConv, setLoadingConv] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  const refreshConversations = useCallback(async () => {
    const res = await fetch("/api/conversations");
    if (res.ok) setConversations((await res.json()).data);
  }, []);

  const send = useCallback(
    async (text: string, base: ChatMessage[]) => {
      const assistantId = uid();
      setMessages([
        ...base,
        { id: uid(), role: "user", content: text },
        { id: assistantId, role: "assistant", content: "" },
      ]);
      setStreaming(true);

      const patch = (fn: (m: ChatMessage) => ChatMessage) =>
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? fn(m) : m)));

      const controller = new AbortController();
      abortRef.current = controller;
      let convId = activeId;

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text, conversationId: activeId }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const err = (await res.json().catch(() => null))?.error;
          throw new Error(err ?? "Request failed");
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        const handle = (e: ChatStreamEvent) => {
          if (e.type === "meta") {
            convId = e.conversationId;
            patch((m) => ({ ...m, sources: e.sources }));
          } else if (e.type === "delta") {
            patch((m) => ({ ...m, content: m.content + e.text }));
          } else if (e.type === "error") {
            patch((m) => ({ ...m, error: e.message }));
          }
        };
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) if (line.trim()) handle(JSON.parse(line));
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          patch((m) => ({
            ...m,
            error: err instanceof Error ? err.message : "Something went wrong",
          }));
        }
      } finally {
        abortRef.current = null;
        setStreaming(false);
        if (convId && convId !== activeId) {
          setActiveId(convId);
          window.history.replaceState(null, "", `/chat/${convId}`);
        }
        if (convId) refreshConversations();
      }
    },
    [activeId, refreshConversations],
  );

  function submit() {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    send(text, messages);
  }

  function retry() {
    // Resend the last user message, replacing the failed exchange.
    const lastUserIdx = messages.map((m) => m.role).lastIndexOf("user");
    if (lastUserIdx === -1 || streaming) return;
    send(messages[lastUserIdx].content, messages.slice(0, lastUserIdx));
  }

  async function openConversation(id: string) {
    if (streaming) return;
    setSidebarOpen(false);
    setLoadingConv(true);
    const res = await fetch(`/api/conversations/${id}`);
    setLoadingConv(false);
    if (!res.ok) return;
    setMessages((await res.json()).data);
    setActiveId(id);
    window.history.replaceState(null, "", `/chat/${id}`);
  }

  function newChat() {
    if (streaming) return;
    setSidebarOpen(false);
    setMessages([]);
    setActiveId(null);
    window.history.replaceState(null, "", "/chat");
  }

  async function removeConversation(id: string) {
    if (!confirm("Delete this conversation?")) return;
    const res = await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    if (!res.ok) return;
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (id === activeId) newChat();
  }

  const lastAssistantId = [...messages].reverse().find((m) => m.role === "assistant")?.id;

  return (
    <div className="relative flex h-[calc(100dvh-13rem)] min-h-[26rem] overflow-hidden rounded-xl border border-border sm:h-[calc(100dvh-16rem)]">
      {/* Sidebar */}
      <aside
        className={`absolute inset-y-0 left-0 z-20 flex w-72 flex-col border-r border-border bg-background transition-transform md:static md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="p-3">
          <button
            type="button"
            onClick={newChat}
            className="h-9 w-full rounded-lg bg-brand text-sm font-medium text-brand-foreground hover:opacity-90"
          >
            + New chat
          </button>
        </div>
        <ul className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
          {conversations.length === 0 && (
            <li className="px-2 py-4 text-center text-xs text-muted">No conversations yet</li>
          )}
          {conversations.map((c) => (
            <li
              key={c.id}
              className={`group flex items-center rounded-lg ${
                c.id === activeId ? "bg-foreground/10" : "hover:bg-foreground/5"
              }`}
            >
              <button
                type="button"
                onClick={() => openConversation(c.id)}
                className="min-w-0 flex-1 truncate px-2.5 py-2 text-left text-sm"
              >
                {c.title}
              </button>
              <button
                type="button"
                onClick={() => removeConversation(c.id)}
                aria-label={`Delete ${c.title}`}
                className="px-2 text-muted opacity-100 hover:text-foreground md:opacity-0 md:group-hover:opacity-100"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      </aside>
      {sidebarOpen && (
        <button
          type="button"
          aria-label="Close sidebar"
          className="absolute inset-0 z-10 bg-black/40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Conversation */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2 md:hidden">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="rounded-lg border border-border px-2.5 py-1 text-sm"
          >
            ☰ Chats
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4" aria-live="polite">
          {loadingConv ? (
            <p className="py-10 text-center text-sm text-muted">Loading…</p>
          ) : messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <h2 className="text-xl font-semibold">How can we help?</h2>
              <p className="max-w-sm text-sm text-muted">
                Ask a question and I&apos;ll answer using our knowledge base.
              </p>
            </div>
          ) : (
            messages.map((m) => (
              <MessageItem
                key={m.id}
                message={m}
                pending={streaming && m.id === lastAssistantId}
                onRetry={m.error && m.id === lastAssistantId ? retry : undefined}
              />
            ))
          )}
          <div ref={bottomRef} />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="flex items-end gap-2 border-t border-border p-3"
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            maxLength={4000}
            placeholder="Type your question…"
            aria-label="Message"
            className="max-h-40 min-h-10 flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
          />
          {streaming ? (
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              className="h-10 rounded-lg border border-border px-4 text-sm font-medium hover:bg-foreground/5"
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="h-10 rounded-lg bg-brand px-4 text-sm font-medium text-brand-foreground hover:opacity-90 disabled:opacity-50"
            >
              Send
            </button>
          )}
        </form>
      </section>
    </div>
  );
}
