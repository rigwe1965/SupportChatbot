import type { EscalationReason } from "@prisma/client";

export interface TicketPayload {
  id: string;
  reason: EscalationReason;
  userName: string | null;
  userEmail: string | null;
  question: string;
  lastAnswer: string | null;
  transcript: { role: string; content: string }[];
}

const REASON_LABEL: Record<EscalationReason, string> = {
  HUMAN_REQUESTED: "Customer asked for a human",
  LOW_CONFIDENCE: "AI not confident in its answer",
  REPEATED_FAILURES: "AI failed to answer repeatedly",
};

// Slack treats &, < and > as control characters (<!channel> would ping everyone).
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

function buildBlocks(t: TicketPayload) {
  const transcript = t.transcript
    .slice(-10)
    .map((m) => `*${m.role === "user" ? "Customer" : "AI"}:* ${esc(clip(m.content, 300))}`)
    .join("\n");
  const adminUrl = `${process.env.NEXTAUTH_URL ?? ""}/admin/tickets`;

  return [
    { type: "header", text: { type: "plain_text", text: "🎫 New support ticket" } },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Customer*\n${esc(t.userName ?? "Unknown")}\n${esc(t.userEmail ?? "")}` },
        { type: "mrkdwn", text: `*Reason*\n${REASON_LABEL[t.reason]}\n*Ticket* #${t.id.slice(-6)}` },
      ],
    },
    { type: "section", text: { type: "mrkdwn", text: `*Original question*\n${esc(clip(t.question, 2500))}` } },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*AI's last answer*\n${esc(clip(t.lastAnswer ?? "—", 2500))}` },
    },
    { type: "section", text: { type: "mrkdwn", text: `*Conversation*\n${clip(transcript, 2800)}` } },
    ...(process.env.NEXTAUTH_URL
      ? [
          {
            type: "actions",
            elements: [
              { type: "button", text: { type: "plain_text", text: "Open in admin" }, url: adminUrl },
            ],
          },
        ]
      : []),
  ];
}

/**
 * Posts a ticket to Slack via a bot token + channel (preferred) or an incoming webhook.
 * Returns true when Slack accepted it; false when not configured or it failed.
 */
export async function postTicketToSlack(t: TicketPayload): Promise<boolean> {
  const body = {
    text: `New support ticket #${t.id.slice(-6)} from ${t.userEmail ?? "a customer"}`,
    blocks: buildBlocks(t),
  };
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_CHANNEL_ID;
  const webhook = process.env.SLACK_WEBHOOK_URL;

  try {
    if (token && channel) {
      const res = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...body, channel }),
        signal: AbortSignal.timeout(8000),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) console.error("Slack chat.postMessage failed:", json.error);
      return json.ok;
    }
    if (webhook) {
      const res = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) console.error("Slack webhook failed:", res.status, await res.text());
      return res.ok;
    }
    console.warn("Slack is not configured (SLACK_WEBHOOK_URL or SLACK_BOT_TOKEN + SLACK_CHANNEL_ID)");
    return false;
  } catch (err) {
    console.error("Slack notification failed", err);
    return false;
  }
}
