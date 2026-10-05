import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatStreamEvent } from "@/types";

vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    conversation: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    message: { findMany: vi.fn(), create: vi.fn() },
  },
}));
vi.mock("@/lib/knowledge", () => ({ retrieve: vi.fn() }));
vi.mock("@/lib/openai-chat", () => ({ streamChat: vi.fn() }));
// Keep the real wantsHuman + thresholds; stub everything that touches the DB / Slack.
vi.mock("@/lib/escalation", async (original) => ({
  ...(await original<typeof import("@/lib/escalation")>()),
  countFailedAttempts: vi.fn(),
  escalate: vi.fn(),
  getOpenTicket: vi.fn(),
}));

vi.mock("@/lib/rate-limit", async (original) => ({
  ...(await original<typeof import("@/lib/rate-limit")>()),
  rateLimit: vi.fn(),
}));

import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { countFailedAttempts, escalate, getOpenTicket } from "@/lib/escalation";
import { retrieve } from "@/lib/knowledge";
import { streamChat } from "@/lib/openai-chat";
import { rateLimit } from "@/lib/rate-limit";
import { POST } from "@/app/api/chat/route";

const m = {
  session: vi.mocked(getSession),
  rateLimit: vi.mocked(rateLimit),
  retrieve: vi.mocked(retrieve),
  streamChat: vi.mocked(streamChat),
  escalate: vi.mocked(escalate),
  openTicket: vi.mocked(getOpenTicket),
  failures: vi.mocked(countFailedAttempts),
  convFind: vi.mocked(db.conversation.findFirst),
  convCreate: vi.mocked(db.conversation.create),
  convUpdate: vi.mocked(db.conversation.update),
  msgFind: vi.mocked(db.message.findMany),
  msgCreate: vi.mocked(db.message.create),
};

const user = { id: "u1", name: "Ada", email: "ada@example.com", role: "FREE" };

const chunk = (similarity: number, extra = {}) => ({
  chunkId: "ch1",
  articleId: "a1",
  title: "Refund policy",
  category: "Billing",
  content: "Refunds are processed within 5 business days.",
  similarity,
  ...extra,
});

function post(body: unknown) {
  return POST(new Request("http://localhost/api/chat", { method: "POST", body: JSON.stringify(body) }));
}

async function events(res: Response): Promise<ChatStreamEvent[]> {
  return (await res.text())
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}
const textOf = (evts: ChatStreamEvent[]) =>
  evts.flatMap((e) => (e.type === "delta" ? [e.text] : [])).join("");

const savedAssistant = () =>
  m.msgCreate.mock.calls.map((c) => c[0].data).find((d) => d.role === "assistant");
const savedUser = () => m.msgCreate.mock.calls.map((c) => c[0].data).find((d) => d.role === "user");

function llmReplies(...parts: string[]) {
  m.streamChat.mockImplementation(async function* () {
    for (const p of parts) yield p;
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  m.session.mockResolvedValue({ user } as never);
  m.rateLimit.mockResolvedValue({ allowed: true, limit: 10, remaining: 9, resetSeconds: 42 });
  m.convFind.mockResolvedValue({ id: "c1" } as never);
  m.convCreate.mockResolvedValue({ id: "c-new" } as never);
  m.convUpdate.mockResolvedValue({} as never);
  m.msgFind.mockResolvedValue([] as never);
  m.msgCreate.mockResolvedValue({ id: "m-assistant" } as never);
  m.openTicket.mockResolvedValue(null);
  m.failures.mockResolvedValue(0);
  m.escalate.mockResolvedValue({ id: "tkt_abcdef" } as never);
  m.retrieve.mockResolvedValue([chunk(0.6)]);
  llmReplies("Refunds take ", "5 days [1].");
});

describe("request validation", () => {
  it("rejects signed-out users", async () => {
    m.session.mockResolvedValue(null);
    expect((await post({ message: "hi" })).status).toBe(401);
    expect(m.retrieve).not.toHaveBeenCalled();
  });

  it.each([{}, { message: "" }, { message: "   " }, { message: 42 }, { message: "x".repeat(4001) }])(
    "returns 400 for message %j",
    async (body) => {
      expect((await post(body)).status).toBe(400);
      expect(m.msgCreate).not.toHaveBeenCalled();
    },
  );

  it("returns 404 for a conversation that isn't the caller's", async () => {
    m.convFind.mockResolvedValue(null);
    const res = await post({ message: "hi", conversationId: "someone-elses" });
    expect(res.status).toBe(404);
    expect(m.convFind).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "someone-elses", userId: "u1" } }));
    expect(m.msgCreate).not.toHaveBeenCalled();
  });

  it("returns 502 and persists nothing when retrieval fails", async () => {
    m.retrieve.mockRejectedValue(new Error("openai down"));
    const res = await post({ message: "How do refunds work?" });
    expect(res.status).toBe(502);
    expect(m.convCreate).not.toHaveBeenCalled();
    expect(m.msgCreate).not.toHaveBeenCalled();
  });
});

describe("rate limiting", () => {
  const blocked = { allowed: false, limit: 10, remaining: 0, resetSeconds: 17 };

  it("limits per signed-in user", async () => {
    await (await post({ message: "hi" })).text();
    expect(m.rateLimit).toHaveBeenCalledWith("chat:u1", expect.any(Array));
  });

  it("returns 429 with Retry-After and does no work when the limit is exceeded", async () => {
    m.rateLimit.mockResolvedValue(blocked);
    const res = await post({ message: "How do refunds work?" });

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("17");
    expect((await res.json()).error).toMatch(/17s/);
    expect(m.retrieve).not.toHaveBeenCalled();
    expect(m.streamChat).not.toHaveBeenCalled();
    expect(m.convCreate).not.toHaveBeenCalled();
    expect(m.msgCreate).not.toHaveBeenCalled();
  });

  it("does not spend a rate-limit slot on signed-out requests", async () => {
    m.session.mockResolvedValue(null);
    await post({ message: "hi" });
    expect(m.rateLimit).not.toHaveBeenCalled();
  });

  it("exposes the remaining quota on successful responses", async () => {
    const res = await post({ message: "hi" });
    expect(res.headers.get("X-RateLimit-Limit")).toBe("10");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("9");
    await res.text();
  });

  it("lets escalated conversations through the same limiter (no bypass)", async () => {
    m.openTicket.mockResolvedValue({ id: "t" } as never);
    m.rateLimit.mockResolvedValue(blocked);
    expect((await post({ message: "hello?", conversationId: "c1" })).status).toBe(429);
  });
});

describe("answering from the knowledge base", () => {
  it("streams meta (with sources), deltas, then done", async () => {
    const res = await post({ message: "How do refunds work?" });
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");

    const evts = await events(res);
    expect(evts[0]).toMatchObject({
      type: "meta",
      conversationId: "c-new",
      sources: [{ n: 1, articleId: "a1", title: "Refund policy", category: "Billing", similarity: 0.6 }],
    });
    expect(textOf(evts)).toBe("Refunds take 5 days [1].");
    expect(evts.at(-1)).toEqual({ type: "done" });
    expect(evts.some((e) => e.type === "escalated")).toBe(false);
    expect(m.escalate).not.toHaveBeenCalled();
  });

  it("creates a conversation titled after the first message, owned by the user", async () => {
    await (await post({ message: "How do refunds work?" })).text();
    expect(m.convCreate).toHaveBeenCalledWith({
      data: { userId: "u1", title: "How do refunds work?" },
      select: { id: true },
    });
  });

  it("saves the user message and the assistant reply with its sources", async () => {
    await (await post({ message: "How do refunds work?" })).text();

    expect(savedUser()).toEqual({ conversationId: "c-new", role: "user", content: "How do refunds work?" });
    expect(savedAssistant()).toMatchObject({
      conversationId: "c-new",
      content: "Refunds take 5 days [1].",
      lowConfidence: false,
      sources: [expect.objectContaining({ n: 1, title: "Refund policy" })],
    });
  });

  it("sends the system prompt with context, prior history, then the new question", async () => {
    m.msgFind.mockResolvedValue([
      { role: "assistant", content: "earlier answer" },
      { role: "user", content: "earlier question" },
    ] as never); // newest first, as the route queries it
    await (await post({ message: "And for gift cards?", conversationId: "c1" })).text();

    const sent = m.streamChat.mock.calls[0][0];
    expect(sent[0].role).toBe("system");
    expect(sent[0].content).toContain("[1] Refund policy (Billing)");
    expect(sent.slice(1)).toEqual([
      { role: "user", content: "earlier question" },
      { role: "assistant", content: "earlier answer" },
      { role: "user", content: "And for gift cards?" },
    ]);
  });

  it("reuses an existing conversation instead of creating one", async () => {
    await (await post({ message: "hi there", conversationId: "c1" })).text();
    expect(m.convCreate).not.toHaveBeenCalled();
    expect(savedUser()?.conversationId).toBe("c1");
  });

  it("still answers, but flags it low-confidence, when the best match is weak yet usable", async () => {
    m.retrieve.mockResolvedValue([chunk(0.3)]); // above 0.25 (usable) but below 0.35 (confident)
    const evts = await events(await post({ message: "vague question" }));

    expect(textOf(evts)).toBe("Refunds take 5 days [1].");
    expect(savedAssistant()?.lowConfidence).toBe(true);
    expect(m.escalate).not.toHaveBeenCalled(); // first miss only
  });
});

describe("saved event (for feedback)", () => {
  it("announces the stored message id, flagged rateable, before done", async () => {
    const evts = await events(await post({ message: "How do refunds work?" }));
    const types = evts.map((e) => e.type);

    expect(evts).toContainEqual({ type: "saved", messageId: "m-assistant", rateable: true });
    expect(types.indexOf("saved")).toBeLessThan(types.indexOf("done"));
    expect(types.at(-1)).toBe("done");
  });

  it("marks the 'could not find it' reply as rateable", async () => {
    m.retrieve.mockResolvedValue([chunk(0.1)]);
    const evts = await events(await post({ message: "something unrelated" }));
    expect(evts).toContainEqual({ type: "saved", messageId: "m-assistant", rateable: true });
  });

  it("marks hand-off and paused notices as not rateable", async () => {
    let evts = await events(await post({ message: "talk to a human" }));
    expect(evts).toContainEqual({ type: "saved", messageId: "m-assistant", rateable: false });

    m.openTicket.mockResolvedValue({ id: "tkt_999999" } as never);
    evts = await events(await post({ message: "any news?", conversationId: "c1" }));
    expect(evts).toContainEqual({ type: "saved", messageId: "m-assistant", rateable: false });
  });

  it("saves a partial answer before reporting the error", async () => {
    m.streamChat.mockImplementation(async function* () {
      yield "Partial ";
      throw new Error("reset");
    });
    const evts = await events(await post({ message: "How do refunds work?" }));
    const types = evts.map((e) => e.type);
    expect(types.indexOf("saved")).toBeLessThan(types.indexOf("error"));
  });

  it("stores each reply exactly once", async () => {
    await (await post({ message: "How do refunds work?" })).text();
    expect(m.msgCreate.mock.calls.filter((c) => c[0].data.role === "assistant")).toHaveLength(1);
  });

  it("sends no saved event when there is no reply to store", async () => {
    m.streamChat.mockImplementation(async function* () {
      throw new Error("boom");
    });
    const evts = await events(await post({ message: "How do refunds work?" }));
    expect(evts.some((e) => e.type === "saved")).toBe(false);
  });
});

describe("no relevant knowledge", () => {
  beforeEach(() => m.retrieve.mockResolvedValue([chunk(0.1)]));

  it("replies with a rephrase prompt without calling the LLM, and records the miss", async () => {
    const evts = await events(await post({ message: "something unrelated" }));

    expect(m.streamChat).not.toHaveBeenCalled();
    expect(textOf(evts)).toMatch(/couldn't find anything/i);
    expect(evts[0]).toMatchObject({ type: "meta", sources: [] });
    expect(savedAssistant()).toMatchObject({ lowConfidence: true });
    expect(m.escalate).not.toHaveBeenCalled();
  });

  it("escalates on the second consecutive miss", async () => {
    m.failures.mockResolvedValue(1);
    const evts = await events(await post({ message: "still nothing", conversationId: "c1" }));

    expect(m.escalate).toHaveBeenCalledWith({
      conversationId: "c1",
      user: expect.objectContaining({ id: "u1", email: "ada@example.com" }),
      reason: "REPEATED_FAILURES",
    });
    expect(evts).toContainEqual({ type: "escalated", ticketId: "tkt_abcdef" });
    expect(textOf(evts)).toMatch(/support team[\s\S]*#abcdef/i);
    expect(m.streamChat).not.toHaveBeenCalled();
    expect(savedAssistant()).toMatchObject({ lowConfidence: false });
  });

  it("treats an empty knowledge base as a miss", async () => {
    m.retrieve.mockResolvedValue([]);
    const evts = await events(await post({ message: "anything" }));
    expect(textOf(evts)).toMatch(/couldn't find anything/i);
  });
});

describe("escalation: customer asks for a human", () => {
  it.each(["I want to talk to a human", "get me an agent", "can I speak with someone?"])(
    "escalates immediately for %j, even when the knowledge base matches",
    async (message) => {
      const evts = await events(await post({ message, conversationId: "c1" }));

      expect(m.escalate).toHaveBeenCalledWith(expect.objectContaining({ conversationId: "c1", reason: "HUMAN_REQUESTED" }));
      expect(m.streamChat).not.toHaveBeenCalled();
      expect(evts).toContainEqual({ type: "escalated", ticketId: "tkt_abcdef" });
      expect(textOf(evts)).toMatch(/human will take over/i);
      expect(textOf(evts)).toContain("#abcdef");
      expect(evts.at(-1)).toEqual({ type: "done" });
    },
  );

  it("saves the user's message before escalating so it is in the ticket transcript", async () => {
    const order: string[] = [];
    m.msgCreate.mockImplementation((async ({ data }: { data: { role: string } }) => {
      order.push(`save:${data.role}`);
    }) as never);
    m.escalate.mockImplementation((async () => {
      order.push("escalate");
      return { id: "tkt_abcdef" };
    }) as never);

    await (await post({ message: "talk to a human" })).text();
    expect(order).toEqual(["save:user", "escalate", "save:assistant"]);
  });

  it("uses REPEATED_FAILURES (not HUMAN_REQUESTED) when escalating because of failed attempts", async () => {
    m.retrieve.mockResolvedValue([]);
    m.failures.mockResolvedValue(1);
    await (await post({ message: "nothing", conversationId: "c1" })).text();
    expect(m.escalate).toHaveBeenCalledWith(expect.objectContaining({ reason: "REPEATED_FAILURES" }));
  });

  it("tells the user something went wrong if the ticket can't be created, without claiming a handover", async () => {
    m.escalate.mockRejectedValue(new Error("db down"));
    const evts = await events(await post({ message: "talk to a human" }));

    expect(evts.at(-1)).toMatchObject({ type: "error" });
    expect(evts.some((e) => e.type === "escalated")).toBe(false);
    expect(savedAssistant()).toBeUndefined();
  });
});

describe("conversation already escalated", () => {
  beforeEach(() => m.openTicket.mockResolvedValue({ id: "tkt_999999" } as never));

  it("pauses the bot: no search, no LLM, no second ticket", async () => {
    const evts = await events(await post({ message: "any update?", conversationId: "c1" }));

    expect(m.retrieve).not.toHaveBeenCalled();
    expect(m.streamChat).not.toHaveBeenCalled();
    expect(m.escalate).not.toHaveBeenCalled();
    expect(evts).toContainEqual({ type: "escalated", ticketId: "tkt_999999" });
    expect(textOf(evts)).toMatch(/already handling/i);
    expect(textOf(evts)).toContain("#999999");
  });

  it("does not create a duplicate ticket when the user asks for a human again", async () => {
    await (await post({ message: "talk to a human!", conversationId: "c1" })).text();
    expect(m.escalate).not.toHaveBeenCalled();
  });

  it("does not count the paused reply as a failed attempt", async () => {
    await (await post({ message: "hello?", conversationId: "c1" })).text();
    expect(savedAssistant()).toMatchObject({ lowConfidence: false });
  });
});

describe("failures while streaming", () => {
  it("emits an error event and keeps the partial answer", async () => {
    m.streamChat.mockImplementation(async function* () {
      yield "Partial ";
      throw new Error("connection reset");
    });
    const evts = await events(await post({ message: "How do refunds work?" }));

    expect(textOf(evts)).toBe("Partial ");
    expect(evts.at(-1)).toMatchObject({ type: "error" });
    expect(evts.some((e) => e.type === "done")).toBe(false);
    expect(savedAssistant()).toMatchObject({ content: "Partial " });
  });

  it("saves nothing for the assistant when the LLM fails immediately", async () => {
    m.streamChat.mockImplementation(async function* () {
      throw new Error("boom");
    });
    const evts = await events(await post({ message: "How do refunds work?" }));
    expect(evts.at(-1)).toMatchObject({ type: "error" });
    expect(savedAssistant()).toBeUndefined();
  });

  it("does not leak internal error details to the client", async () => {
    m.streamChat.mockImplementation(async function* () {
      throw new Error("OpenAI chat failed (401): sk-secret-key");
    });
    const raw = await (await post({ message: "How do refunds work?" })).text();
    expect(raw).not.toContain("sk-secret-key");
  });

  it("bumps the conversation's updatedAt after each exchange", async () => {
    await (await post({ message: "hi" })).text();
    expect(m.convUpdate).toHaveBeenCalledWith({
      where: { id: "c-new" },
      data: { updatedAt: expect.any(Date) },
    });
  });
});
