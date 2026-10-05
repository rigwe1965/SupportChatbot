import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postTicketToSlack, type TicketPayload } from "@/lib/slack";

const ticket: TicketPayload = {
  id: "ckabcdef123456",
  reason: "HUMAN_REQUESTED",
  userName: "Ada",
  userEmail: "ada@example.com",
  question: "Where is my invoice?",
  lastAnswer: "I couldn't find that.",
  transcript: [
    { role: "user", content: "Where is my invoice?" },
    { role: "assistant", content: "I couldn't find that." },
  ],
};

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function bodyOf(call = 0) {
  return JSON.parse(fetchMock.mock.calls[call][1].body);
}

describe("postTicketToSlack", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("SLACK_BOT_TOKEN", "");
    vi.stubEnv("SLACK_CHANNEL_ID", "");
    vi.stubEnv("SLACK_WEBHOOK_URL", "");
    vi.stubEnv("NEXTAUTH_URL", "https://support.example.com");
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => vi.unstubAllGlobals());

  it("returns false without calling Slack when nothing is configured", async () => {
    expect(await postTicketToSlack(ticket)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts via an incoming webhook", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.test/abc");
    fetchMock.mockResolvedValue(new Response("ok"));

    expect(await postTicketToSlack(ticket)).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe("https://hooks.slack.test/abc");
    const body = bodyOf();
    expect(body.text).toContain("#123456");
    expect(body.text).toContain("ada@example.com");
    expect(body.channel).toBeUndefined();
  });

  it("prefers the bot token + channel over the webhook", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.test/abc");
    vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-1");
    vi.stubEnv("SLACK_CHANNEL_ID", "C123");
    fetchMock.mockResolvedValue(json({ ok: true }));

    expect(await postTicketToSlack(ticket)).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe("https://slack.com/api/chat.postMessage");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer xoxb-1");
    expect(bodyOf().channel).toBe("C123");
  });

  it("returns false when the Slack API rejects the message", async () => {
    vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-1");
    vi.stubEnv("SLACK_CHANNEL_ID", "C123");
    fetchMock.mockResolvedValue(json({ ok: false, error: "channel_not_found" }));
    expect(await postTicketToSlack(ticket)).toBe(false);
  });

  it("returns false on a non-2xx webhook response", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.test/abc");
    fetchMock.mockResolvedValue(new Response("invalid_payload", { status: 400 }));
    expect(await postTicketToSlack(ticket)).toBe(false);
  });

  it("never throws on network failure", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.test/abc");
    fetchMock.mockRejectedValue(new Error("network down"));
    await expect(postTicketToSlack(ticket)).resolves.toBe(false);
  });

  describe("message content", () => {
    beforeEach(() => {
      vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.test/abc");
      fetchMock.mockResolvedValue(new Response("ok"));
    });
    const allText = () => JSON.stringify(bodyOf().blocks);

    it("includes customer, reason, question, last answer and conversation", async () => {
      await postTicketToSlack(ticket);
      const text = allText();
      for (const expected of ["Ada", "ada@example.com", "Customer asked for a human", "#123456", "Where is my invoice?", "I couldn't find that."]) {
        expect(text).toContain(expected);
      }
    });

    it("neutralises Slack control characters so users cannot ping the channel", async () => {
      await postTicketToSlack({
        ...ticket,
        question: "<!channel> hello <@U123> & <https://evil.test|click>",
        lastAnswer: "<!here>",
        transcript: [{ role: "user", content: "<!everyone>" }],
        userName: "<!channel>",
      });
      const text = allText();
      expect(text).not.toContain("<!channel>");
      expect(text).not.toContain("<!here>");
      expect(text).not.toContain("<!everyone>");
      expect(text).not.toContain("<@U123>");
      expect(text).toContain("&lt;!channel&gt;");
      expect(text).toContain("&amp;");
    });

    it("truncates very long content to stay within Slack's block limits", async () => {
      await postTicketToSlack({ ...ticket, question: "q".repeat(10_000), lastAnswer: "a".repeat(10_000) });
      for (const block of bodyOf().blocks) {
        if (block.text?.type === "mrkdwn") expect(block.text.text.length).toBeLessThanOrEqual(3000);
      }
    });

    it("includes only the last 10 messages of the conversation", async () => {
      const transcript = Array.from({ length: 15 }, (_, i) => ({ role: "user", content: `message-${i}-end` }));
      await postTicketToSlack({ ...ticket, transcript });
      const text = allText();
      expect(text).not.toContain("message-4-end");
      expect(text).toContain("message-5-end");
      expect(text).toContain("message-14-end");
    });

    it("links to the admin tickets page only when NEXTAUTH_URL is set", async () => {
      await postTicketToSlack(ticket);
      expect(allText()).toContain("https://support.example.com/admin/tickets");

      fetchMock.mockClear();
      vi.stubEnv("NEXTAUTH_URL", "");
      await postTicketToSlack(ticket);
      expect(allText()).not.toContain("/admin/tickets");
    });

    it("falls back gracefully for unknown users and missing answers", async () => {
      await postTicketToSlack({ ...ticket, userName: null, userEmail: null, lastAnswer: null });
      expect(allText()).toContain("Unknown");
      expect(bodyOf().text).toContain("a customer");
    });
  });
});
