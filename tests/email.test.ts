import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendEmail } from "@/lib/email";
import { buildTicketEmail, sendTicketEmail, ticketRecipients } from "@/lib/ticket-email";
import type { TicketPayload } from "@/lib/ticket-format";

const fetchMock = vi.fn();

const ticket: TicketPayload = {
  id: "ckabcdef123456",
  reason: "HUMAN_REQUESTED",
  userName: "Ada",
  userEmail: "ada@example.com",
  question: "Where is my invoice?",
  lastAnswer: "I could not find that.",
  transcript: [
    { role: "user", content: "Where is my invoice?" },
    { role: "assistant", content: "I could not find that." },
    { role: "user", content: "talk to a human" },
  ],
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("EMAIL_FROM", "");
  vi.stubEnv("TICKET_NOTIFY_EMAILS", "");
  vi.stubEnv("ADMIN_EMAILS", "");
  vi.stubEnv("NEXTAUTH_URL", "https://support.example.com");
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.unstubAllGlobals());

const sentBody = () => JSON.parse(fetchMock.mock.calls[0][1].body);

describe("sendEmail", () => {
  const msg = { to: ["a@x.com"], subject: "S", html: "<p>h</p>", text: "t" };

  it("returns false without calling the API when no key is configured", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    expect(await sendEmail(msg)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns false without calling the API when there are no recipients", async () => {
    expect(await sendEmail({ ...msg, to: [] })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts to Resend with the key, sender, recipients and both bodies", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "1" })));
    vi.stubEnv("EMAIL_FROM", "Support <support@acme.com>");

    expect(await sendEmail({ ...msg, replyTo: "cust@x.com" })).toBe(true);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers.Authorization).toBe("Bearer re_test");
    expect(sentBody()).toEqual({
      from: "Support <support@acme.com>",
      to: ["a@x.com"],
      subject: "S",
      html: "<p>h</p>",
      text: "t",
      reply_to: "cust@x.com",
    });
  });

  it("uses Resend's test sender when EMAIL_FROM is unset and omits reply_to when absent", async () => {
    fetchMock.mockResolvedValue(new Response("{}"));
    await sendEmail(msg);
    expect(sentBody().from).toContain("onboarding@resend.dev");
    expect(sentBody()).not.toHaveProperty("reply_to");
  });

  it("returns false on API errors", async () => {
    fetchMock.mockResolvedValue(new Response("domain not verified", { status: 403 }));
    expect(await sendEmail(msg)).toBe(false);
  });

  it("never throws on network failure", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    await expect(sendEmail(msg)).resolves.toBe(false);
  });
});

describe("ticketRecipients", () => {
  it("uses TICKET_NOTIFY_EMAILS when set", () => {
    vi.stubEnv("TICKET_NOTIFY_EMAILS", "a@x.com, B@x.com");
    vi.stubEnv("ADMIN_EMAILS", "admin@x.com");
    expect(ticketRecipients()).toEqual(["a@x.com", "b@x.com"]);
  });

  it("falls back to ADMIN_EMAILS", () => {
    vi.stubEnv("ADMIN_EMAILS", "admin@x.com");
    expect(ticketRecipients()).toEqual(["admin@x.com"]);
  });

  it("drops invalid addresses and duplicates", () => {
    vi.stubEnv("TICKET_NOTIFY_EMAILS", "a@x.com,A@x.com,not-an-email,,<evil@x.com>, b@x");
    expect(ticketRecipients()).toEqual(["a@x.com"]);
  });

  it("is empty when nothing is configured", () => {
    expect(ticketRecipients()).toEqual([]);
  });
});

describe("buildTicketEmail", () => {
  it("has a subject with the short ticket id and reason, but none of the customer's text", () => {
    const { subject } = buildTicketEmail({ ...ticket, question: "SECRET-QUESTION" });
    expect(subject).toBe("[Support] New ticket #123456: Customer asked for a human");
    expect(subject).not.toContain("SECRET-QUESTION");
  });

  it("includes customer, question, last answer and conversation in both formats", () => {
    const { text, html } = buildTicketEmail(ticket);
    for (const body of [text, html]) {
      for (const expected of ["Ada", "ada@example.com", "Where is my invoice?", "I could not find that.", "talk to a human"]) {
        expect(body).toContain(expected.replace("<", "&lt;"));
      }
    }
  });

  it("links to the ticket in the admin when NEXTAUTH_URL is set", () => {
    const { text, html } = buildTicketEmail(ticket);
    expect(text).toContain("https://support.example.com/admin/tickets/ckabcdef123456");
    expect(html).toContain('href="https://support.example.com/admin/tickets/ckabcdef123456"');

    vi.stubEnv("NEXTAUTH_URL", "");
    const without = buildTicketEmail(ticket);
    expect(without.text).not.toContain("/admin/tickets");
    expect(without.html).not.toContain("href=");
  });

  it("HTML-escapes everything customers can write, so emails can't carry markup or scripts", () => {
    const evil = '<script>alert(1)</script><img src=x onerror="steal()">';
    const { html } = buildTicketEmail({
      ...ticket,
      userName: evil,
      question: evil,
      lastAnswer: evil,
      transcript: [{ role: "user", content: evil }],
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&quot;steal()&quot;");
  });

  it("only includes the last 10 messages and clips very long content", () => {
    const transcript = Array.from({ length: 15 }, (_, i) => ({ role: "user", content: `msg-${i}-end` }));
    const { text } = buildTicketEmail({ ...ticket, transcript, question: "q".repeat(10_000) });
    expect(text).not.toContain("msg-4-end");
    expect(text).toContain("msg-5-end");
    expect(text.length).toBeLessThan(6000);
  });

  it("copes with unknown users and no previous answer", () => {
    const { text } = buildTicketEmail({ ...ticket, userName: null, userEmail: null, lastAnswer: null });
    expect(text).toContain("Customer: Unknown");
  });
});

describe("sendTicketEmail", () => {
  beforeEach(() => vi.stubEnv("TICKET_NOTIFY_EMAILS", "team@acme.com,boss@acme.com"));

  it("sends to the team with Reply-To set to the customer", async () => {
    fetchMock.mockResolvedValue(new Response("{}"));
    expect(await sendTicketEmail(ticket)).toBe(true);

    expect(sentBody()).toMatchObject({
      to: ["team@acme.com", "boss@acme.com"],
      reply_to: "ada@example.com",
      subject: expect.stringContaining("#123456"),
    });
  });

  it("omits Reply-To when the customer's email is missing or malformed", async () => {
    fetchMock.mockResolvedValue(new Response("{}"));
    await sendTicketEmail({ ...ticket, userEmail: "not an email" });
    expect(sentBody()).not.toHaveProperty("reply_to");
  });

  it("does nothing when there is nobody to notify", async () => {
    vi.stubEnv("TICKET_NOTIFY_EMAILS", "");
    expect(await sendTicketEmail(ticket)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports failure instead of throwing when sending fails", async () => {
    fetchMock.mockRejectedValue(new Error("boom"));
    await expect(sendTicketEmail(ticket)).resolves.toBe(false);
  });
});
