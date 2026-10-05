import { sendEmail } from "@/lib/email";
import { REASON_LABEL, clip, isEmail, shortTicketId, type TicketPayload } from "@/lib/ticket-format";

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** Who gets notified: TICKET_NOTIFY_EMAILS, falling back to ADMIN_EMAILS. */
export function ticketRecipients(): string[] {
  const raw = process.env.TICKET_NOTIFY_EMAILS?.trim() ? process.env.TICKET_NOTIFY_EMAILS : process.env.ADMIN_EMAILS;
  const emails = (raw ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(isEmail);
  return Array.from(new Set(emails));
}

export function buildTicketEmail(t: TicketPayload) {
  const id = shortTicketId(t.id);
  const adminUrl = process.env.NEXTAUTH_URL ? `${process.env.NEXTAUTH_URL}/admin/tickets/${t.id}` : null;
  const customer = [t.userName, t.userEmail && `<${t.userEmail}>`].filter(Boolean).join(" ") || "Unknown";
  const messages = t.transcript.slice(-10).map((m) => ({
    who: m.role === "user" ? "Customer" : "AI",
    content: clip(m.content, 500),
  }));
  const question = clip(t.question, 2000);
  const lastAnswer = clip(t.lastAnswer ?? "—", 2000);

  // The subject deliberately contains no customer-written text.
  const subject = `[Support] New ticket #${id}: ${REASON_LABEL[t.reason]}`;

  const text = [
    `New support ticket #${id}`,
    `Reason: ${REASON_LABEL[t.reason]}`,
    `Customer: ${customer}`,
    "",
    "Original question:",
    question,
    "",
    "AI's last answer:",
    lastAnswer,
    "",
    "Conversation:",
    ...messages.map((m) => `${m.who}: ${m.content}`),
    ...(adminUrl ? ["", `Open ticket: ${adminUrl}`] : []),
  ].join("\n");

  const block = (title: string, body: string) =>
    `<h3 style="margin:20px 0 6px;font-size:14px">${title}</h3><div style="white-space:pre-wrap;font-size:14px;color:#374151">${escapeHtml(body)}</div>`;

  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f3f4f6;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;padding:24px;border:1px solid #e5e7eb">
<h2 style="margin:0 0 4px;font-size:20px">New support ticket #${escapeHtml(id)}</h2>
<p style="margin:0;color:#6b7280;font-size:14px">${escapeHtml(REASON_LABEL[t.reason])}</p>
${block("Customer", customer)}
${block("Original question", question)}
${block("AI's last answer", lastAnswer)}
<h3 style="margin:20px 0 6px;font-size:14px">Conversation</h3>
${messages
  .map(
    (m) =>
      `<p style="margin:4px 0;font-size:14px;color:#374151"><strong>${m.who}:</strong> ${escapeHtml(m.content)}</p>`,
  )
  .join("\n")}
${
  adminUrl
    ? `<p style="margin:24px 0 0"><a href="${escapeHtml(adminUrl)}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px">Open ticket</a></p>`
    : ""
}
</div></body></html>`;

  return { subject, text, html };
}

/** Emails the support team about a new ticket. Returns true if the email was accepted. */
export async function sendTicketEmail(t: TicketPayload): Promise<boolean> {
  const to = ticketRecipients();
  if (to.length === 0) {
    console.warn("No ticket email recipients (set TICKET_NOTIFY_EMAILS or ADMIN_EMAILS)");
    return false;
  }
  const { subject, text, html } = buildTicketEmail(t);
  // Reply-To lets staff answer the customer straight from their inbox.
  const replyTo = t.userEmail && isEmail(t.userEmail) ? t.userEmail : undefined;
  return sendEmail({ to, subject, text, html, replyTo });
}
