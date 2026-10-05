export interface EmailMessage {
  to: string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}

/**
 * Sends an email through Resend's HTTP API (https://resend.com).
 * Returns true when accepted; false when not configured or on any failure. Never throws.
 */
export async function sendEmail(msg: EmailMessage): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("Email is not configured (RESEND_API_KEY)");
    return false;
  }
  if (msg.to.length === 0) return false;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || "SupportChatbot <onboarding@resend.dev>",
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) console.error("Resend failed:", res.status, await res.text());
    return res.ok;
  } catch (err) {
    console.error("Sending email failed", err);
    return false;
  }
}
