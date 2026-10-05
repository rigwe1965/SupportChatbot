import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    message: { findMany: vi.fn() },
    ticket: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
  },
}));
vi.mock("@/lib/slack", () => ({ postTicketToSlack: vi.fn() }));
vi.mock("@/lib/ticket-email", () => ({ sendTicketEmail: vi.fn() }));

import { db } from "@/lib/db";
import { postTicketToSlack } from "@/lib/slack";
import { sendTicketEmail } from "@/lib/ticket-email";
import { countFailedAttempts, escalate, wantsHuman } from "@/lib/escalation";

const mdb = db as unknown as {
  message: { findMany: ReturnType<typeof vi.fn> };
  ticket: { create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
};
const slack = postTicketToSlack as unknown as ReturnType<typeof vi.fn>;
const email = sendTicketEmail as unknown as ReturnType<typeof vi.fn>;

describe("wantsHuman", () => {
  it.each([
    "I want to talk to a human",
    "can I speak with someone?",
    "get me an agent please",
    "connect me to a real person",
    "I need a live agent",
    "Let me talk to your manager",
    "TRANSFER ME TO A REPRESENTATIVE",
  ])("detects %j", (text) => {
    expect(wantsHuman(text)).toBe(true);
  });

  it.each([
    "Where is my order?",
    "How do I contact the support team?",
    "My password reset email never arrives",
    "What is your refund policy?",
    "I can't log in to my account",
    "",
  ])("ignores %j", (text) => {
    expect(wantsHuman(text)).toBe(false);
  });

  it("does not match across sentences", () => {
    expect(wantsHuman("I want a refund. The agent was rude.")).toBe(false);
  });
});

describe("escalation config", () => {
  async function load(env: Record<string, string>) {
    vi.resetModules();
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    return import("@/lib/escalation");
  }

  it("has sensible defaults", async () => {
    const m = await load({});
    expect(m.MAX_FAILED_ATTEMPTS).toBe(2);
    expect(m.CONFIDENCE_THRESHOLD).toBe(0.35);
  });

  it("reads overrides from the environment", async () => {
    const m = await load({ ESCALATION_MAX_FAILED_ATTEMPTS: "3", ESCALATION_MIN_SIMILARITY: "0.5" });
    expect(m.MAX_FAILED_ATTEMPTS).toBe(3);
    expect(m.CONFIDENCE_THRESHOLD).toBe(0.5);
  });

  it("never allows fewer than one attempt and ignores garbage", async () => {
    expect((await load({ ESCALATION_MAX_FAILED_ATTEMPTS: "0" })).MAX_FAILED_ATTEMPTS).toBe(1);
    const m = await load({ ESCALATION_MAX_FAILED_ATTEMPTS: "abc", ESCALATION_MIN_SIMILARITY: "" });
    expect(m.MAX_FAILED_ATTEMPTS).toBe(2);
    expect(m.CONFIDENCE_THRESHOLD).toBe(0.35);
  });
});

describe("countFailedAttempts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("counts only the unbroken streak of low-confidence replies at the end", async () => {
    mdb.message.findMany.mockResolvedValue([
      { lowConfidence: true },
      { lowConfidence: true },
      { lowConfidence: false },
    ]);
    expect(await countFailedAttempts("c1")).toBe(2);
  });

  it("is zero when the latest reply was fine", async () => {
    mdb.message.findMany.mockResolvedValue([{ lowConfidence: false }, { lowConfidence: true }]);
    expect(await countFailedAttempts("c1")).toBe(0);
  });

  it("is zero for a new conversation", async () => {
    mdb.message.findMany.mockResolvedValue([]);
    expect(await countFailedAttempts("c1")).toBe(0);
  });

  it("looks at assistant messages newest first", async () => {
    mdb.message.findMany.mockResolvedValue([]);
    await countFailedAttempts("c1");
    expect(mdb.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { conversationId: "c1", role: "assistant" },
        orderBy: { createdAt: "desc" },
      }),
    );
  });
});

describe("escalate", () => {
  const at = (n: number) => new Date(2026, 0, 1, 0, n);
  const messages = [
    { role: "user", content: "Where is my invoice?", createdAt: at(0) },
    { role: "assistant", content: "I couldn't find that.", createdAt: at(1) },
    { role: "user", content: "Still nothing, help", createdAt: at(2) },
    { role: "assistant", content: "Could you rephrase?", createdAt: at(3) },
    { role: "user", content: "talk to a human", createdAt: at(4) },
  ];
  const user = { id: "u1", name: "Ada", email: "ada@example.com" };

  beforeEach(() => {
    vi.clearAllMocks();
    mdb.message.findMany.mockResolvedValue(messages);
    mdb.ticket.create.mockImplementation(async ({ data }) => ({ id: "t_123456", ...data }));
    mdb.ticket.update.mockResolvedValue({});
    slack.mockResolvedValue(true);
    email.mockResolvedValue(false);
  });

  it("saves an open ticket with user info, original question, last answer and transcript", async () => {
    await escalate({ conversationId: "c1", user, reason: "HUMAN_REQUESTED" });

    const { data } = mdb.ticket.create.mock.calls[0][0];
    expect(data).toMatchObject({
      reason: "HUMAN_REQUESTED",
      question: "Where is my invoice?",
      lastAnswer: "Could you rephrase?",
      conversationId: "c1",
      userId: "u1",
      userName: "Ada",
      userEmail: "ada@example.com",
    });
    expect(data.transcript).toHaveLength(5);
    expect(data.transcript[0]).toEqual({
      role: "user",
      content: "Where is my invoice?",
      at: at(0).toISOString(),
    });
    // status is left to the DB default (OPEN)
    expect(data.status).toBeUndefined();
  });

  it("keeps only the last 50 messages in the snapshot", async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      role: i % 2 ? "assistant" : "user",
      content: `m${i}`,
      createdAt: at(i % 59),
    }));
    mdb.message.findMany.mockResolvedValue(many);
    await escalate({ conversationId: "c1", user, reason: "LOW_CONFIDENCE" });
    const { data } = mdb.ticket.create.mock.calls[0][0];
    expect(data.transcript).toHaveLength(50);
    expect(data.transcript[0].content).toBe("m10");
  });

  it("has no last answer when the AI never replied", async () => {
    mdb.message.findMany.mockResolvedValue([messages[0]]);
    await escalate({ conversationId: "c1", user, reason: "LOW_CONFIDENCE" });
    expect(mdb.ticket.create.mock.calls[0][0].data.lastAnswer).toBeNull();
  });

  it("posts to Slack and records when it was sent", async () => {
    await escalate({ conversationId: "c1", user, reason: "REPEATED_FAILURES" });

    expect(slack).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "t_123456",
        reason: "REPEATED_FAILURES",
        userName: "Ada",
        userEmail: "ada@example.com",
        question: "Where is my invoice?",
        lastAnswer: "Could you rephrase?",
      }),
    );
    expect(mdb.ticket.update).toHaveBeenCalledWith({
      where: { id: "t_123456" },
      data: { slackPostedAt: expect.any(Date) },
    });
  });

  it("still returns the ticket when Slack fails, without marking it as posted", async () => {
    slack.mockResolvedValue(false);
    const ticket = await escalate({ conversationId: "c1", user, reason: "HUMAN_REQUESTED" });
    expect(ticket.id).toBe("t_123456");
    expect(mdb.ticket.update).not.toHaveBeenCalled();
  });

  describe("email notification", () => {
    it("emails the team with the same payload as Slack", async () => {
      await escalate({ conversationId: "c1", user, reason: "HUMAN_REQUESTED" });
      expect(email).toHaveBeenCalledWith(slack.mock.calls[0][0]);
      expect(email).toHaveBeenCalledWith(
        expect.objectContaining({ id: "t_123456", userEmail: "ada@example.com", question: "Where is my invoice?" }),
      );
    });

    it("records emailSentAt (and not slackPostedAt) when only the email went out", async () => {
      slack.mockResolvedValue(false);
      email.mockResolvedValue(true);
      await escalate({ conversationId: "c1", user, reason: "HUMAN_REQUESTED" });

      const { data } = mdb.ticket.update.mock.calls[0][0];
      expect(data.emailSentAt).toBeInstanceOf(Date);
      expect(data).not.toHaveProperty("slackPostedAt");
    });

    it("records both timestamps when both channels succeed", async () => {
      email.mockResolvedValue(true);
      await escalate({ conversationId: "c1", user, reason: "HUMAN_REQUESTED" });
      const { data } = mdb.ticket.update.mock.calls[0][0];
      expect(Object.keys(data).sort()).toEqual(["emailSentAt", "slackPostedAt"]);
    });

    it("starts Slack and email together, so a slow channel doesn't delay the other", async () => {
      const started: string[] = [];
      slack.mockImplementation(async () => {
        started.push("slack");
        await new Promise((r) => setTimeout(r, 20));
        return true;
      });
      email.mockImplementation(async () => {
        started.push("email");
        return true;
      });
      await escalate({ conversationId: "c1", user, reason: "HUMAN_REQUESTED" });
      expect(started).toEqual(["slack", "email"]);
    });

    it("does not touch the ticket when nothing could be sent", async () => {
      slack.mockResolvedValue(false);
      email.mockResolvedValue(false);
      await escalate({ conversationId: "c1", user, reason: "HUMAN_REQUESTED" });
      expect(mdb.ticket.update).not.toHaveBeenCalled();
    });

    it("is not sent for a duplicate escalation", async () => {
      mdb.ticket.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "test" }),
      );
      mdb.ticket.findFirst.mockResolvedValue({ id: "existing" });
      await escalate({ conversationId: "c1", user, reason: "HUMAN_REQUESTED" });
      expect(email).not.toHaveBeenCalled();
    });
  });

  it("is idempotent: a concurrent duplicate returns the existing open ticket", async () => {
    mdb.ticket.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
      }),
    );
    mdb.ticket.findFirst.mockResolvedValue({ id: "existing" });

    const ticket = await escalate({ conversationId: "c1", user, reason: "HUMAN_REQUESTED" });

    expect(ticket).toEqual({ id: "existing" });
    expect(slack).not.toHaveBeenCalled();
  });

  it("rethrows other database errors and does not notify Slack", async () => {
    mdb.ticket.create.mockRejectedValue(new Error("db down"));
    await expect(escalate({ conversationId: "c1", user, reason: "HUMAN_REQUESTED" })).rejects.toThrow("db down");
    expect(slack).not.toHaveBeenCalled();
  });
});
