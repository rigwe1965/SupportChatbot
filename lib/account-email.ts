import { sendEmail } from "@/lib/email";

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** Public base URL for links in emails. Taken from config, never from the request (host-header injection). */
export const baseUrl = () => (process.env.NEXTAUTH_URL || "http://localhost:3000").replace(/\/+$/, "");

interface Content {
  subject: string;
  text: string;
  html: string;
}

function layout(heading: string, paragraphs: string[], button?: { label: string; url: string }): Pick<Content, "html"> {
  return {
    html: `<!doctype html><html><body style="margin:0;padding:24px;background:#f3f4f6;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:24px;border:1px solid #e5e7eb">
<h2 style="margin:0 0 12px;font-size:20px">${escapeHtml(heading)}</h2>
${paragraphs.map((p) => `<p style="margin:8px 0;font-size:14px;color:#374151">${escapeHtml(p)}</p>`).join("\n")}
${
  button
    ? `<p style="margin:24px 0"><a href="${escapeHtml(button.url)}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px">${escapeHtml(button.label)}</a></p>
<p style="margin:8px 0;font-size:12px;color:#6b7280;word-break:break-all">Or paste this link into your browser:<br>${escapeHtml(button.url)}</p>`
    : ""
}
</div></body></html>`,
  };
}

function build(subject: string, heading: string, paragraphs: string[], button?: { label: string; url: string }): Content {
  const text = [heading, "", ...paragraphs, ...(button ? ["", `${button.label}: ${button.url}`] : [])].join("\n");
  return { subject, text, ...layout(heading, paragraphs, button) };
}

export const verifyEmailContent = (token: string) =>
  build(
    "Confirm your email address",
    "Confirm your email",
    ["Thanks for signing up. Confirm your email address to finish creating your account. The link works for 24 hours.", "If you didn't sign up, you can ignore this email."],
    { label: "Confirm email", url: `${baseUrl()}/verify-email?token=${encodeURIComponent(token)}` },
  );

export const resetPasswordContent = (token: string) =>
  build(
    "Reset your password",
    "Reset your password",
    ["We received a request to set a new password for your account. The link works for 1 hour and can only be used once.", "If you didn't ask for this, you can ignore this email. Your password won't change."],
    { label: "Choose a new password", url: `${baseUrl()}/reset-password?token=${encodeURIComponent(token)}` },
  );

/** Sent instead of a second account when someone signs up with an email that already exists. */
export const alreadyRegisteredContent = () =>
  build(
    "You already have an account",
    "You already have an account",
    ["Someone tried to create an account with this email address, but one already exists.", "If it was you, sign in, or choose \"Forgot password\" to set a password. If it wasn't you, you can ignore this email."],
    { label: "Go to sign in", url: `${baseUrl()}/signin` },
  );

export const passwordChangedContent = () =>
  build(
    "Your password was changed",
    "Your password was changed",
    ["The password for your account was just changed.", "If this was you, there's nothing more to do. If it wasn't, reset your password straight away and contact support."],
    { label: "Reset password", url: `${baseUrl()}/forgot-password` },
  );

export const accountDeletedContent = () =>
  build("Your account was deleted", "Your account was deleted", [
    "Your account and your chat history have been permanently deleted.",
    "If this wasn't you, contact support right away.",
  ]);

/**
 * Sends an account email. In development with no email provider configured the message is printed
 * to the server console instead, so the flow can be tried locally. Never prints in production.
 */
export async function sendAccountEmail(to: string, content: Content): Promise<boolean> {
  if (!process.env.RESEND_API_KEY && process.env.NODE_ENV !== "production") {
    console.info(`\n[dev email] to: ${to}\nsubject: ${content.subject}\n${content.text}\n`);
    return true;
  }
  return sendEmail({ to: [to], subject: content.subject, html: content.html, text: content.text });
}
