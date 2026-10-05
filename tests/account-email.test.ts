import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));

import {
  alreadyRegisteredContent,
  baseUrl,
  passwordChangedContent,
  resetPasswordContent,
  sendAccountEmail,
  verifyEmailContent,
} from "@/lib/account-email";
import { sendEmail } from "@/lib/email";

const mockSend = vi.mocked(sendEmail);

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXTAUTH_URL", "https://support.example.com/");
});
afterEach(() => vi.restoreAllMocks());

describe("links", () => {
  it("are built from NEXTAUTH_URL (never from request data) without a double slash", () => {
    expect(baseUrl()).toBe("https://support.example.com");
    expect(verifyEmailContent("abc").text).toContain("https://support.example.com/verify-email?token=abc");
    expect(resetPasswordContent("abc").text).toContain("https://support.example.com/reset-password?token=abc");
  });

  it("fall back to localhost in development", () => {
    vi.stubEnv("NEXTAUTH_URL", "");
    expect(baseUrl()).toBe("http://localhost:3000");
  });

  it("URL-encode the token", () => {
    expect(resetPasswordContent("a b&c").text).toContain("token=a%20b%26c");
  });

  it("appear in both the HTML button and the plain-text part", () => {
    const { html, text } = resetPasswordContent("tok123");
    expect(html).toContain('href="https://support.example.com/reset-password?token=tok123"');
    expect(text).toContain("reset-password?token=tok123");
  });
});

describe("content", () => {
  it("states how long each link works", () => {
    expect(verifyEmailContent("t").text).toMatch(/24 hours/);
    expect(resetPasswordContent("t").text).toMatch(/1 hour/);
    expect(resetPasswordContent("t").text).toMatch(/only be used once/);
  });

  it("tells people to ignore emails they didn't ask for", () => {
    expect(verifyEmailContent("t").text).toMatch(/didn't sign up/);
    expect(resetPasswordContent("t").text).toMatch(/didn't ask for this/);
  });

  it("the 'already registered' email points to sign in, not to a token", () => {
    const { text, subject } = alreadyRegisteredContent();
    expect(subject).toMatch(/already have an account/);
    expect(text).toContain("https://support.example.com/signin");
    expect(text).not.toMatch(/token=/);
  });

  it("the 'password changed' email warns and links to a new reset", () => {
    const { text } = passwordChangedContent();
    expect(text).toMatch(/wasn't, reset your password/);
    expect(text).toContain("/forgot-password");
  });

  it("HTML-escapes the link so a crafted value can't inject markup", () => {
    const { html } = resetPasswordContent('"><script>alert(1)</script>');
    expect(html).not.toContain("<script>");
  });
});

describe("sendAccountEmail", () => {
  it("sends through the email provider when one is configured", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    mockSend.mockResolvedValue(true);
    const content = resetPasswordContent("tok");

    expect(await sendAccountEmail("ada@example.com", content)).toBe(true);
    expect(mockSend).toHaveBeenCalledWith({
      to: ["ada@example.com"],
      subject: content.subject,
      html: content.html,
      text: content.text,
    });
  });

  it("reports failure when the provider rejects it", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    mockSend.mockResolvedValue(false);
    expect(await sendAccountEmail("ada@example.com", resetPasswordContent("tok"))).toBe(false);
  });

  it("in development without a provider, prints the email so the flow can be tried locally", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("NODE_ENV", "development");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    expect(await sendAccountEmail("ada@example.com", resetPasswordContent("tok"))).toBe(true);
    expect(mockSend).not.toHaveBeenCalled();
    expect(info.mock.calls[0][0]).toContain("reset-password?token=tok");
  });

  it("in production without a provider, never prints the link to the logs", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    mockSend.mockResolvedValue(false);

    expect(await sendAccountEmail("ada@example.com", resetPasswordContent("secret-token"))).toBe(false);
    expect(info).not.toHaveBeenCalled();
  });
});
