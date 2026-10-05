import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { user: { findUnique: vi.fn() } } }));

import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseArticle, requireAdmin } from "@/lib/guard";
import { buildSystemPrompt } from "@/lib/prompt";

const session = getSession as unknown as ReturnType<typeof vi.fn>;
const findUser = (db as unknown as { user: { findUnique: ReturnType<typeof vi.fn> } }).user.findUnique;

describe("requireAdmin", () => {
  beforeEach(() => vi.clearAllMocks());

  it("401 when signed out", async () => {
    session.mockResolvedValue(null);
    const r = await requireAdmin();
    expect("error" in r && r.error.status).toBe(401);
  });

  it("403 for non-admins, checking the DB rather than the token", async () => {
    session.mockResolvedValue({ user: { id: "u1", role: "ADMIN" } }); // stale token says admin
    findUser.mockResolvedValue({ role: "FREE" });
    const r = await requireAdmin();
    expect("error" in r && r.error.status).toBe(403);
  });

  it("403 when the user no longer exists", async () => {
    session.mockResolvedValue({ user: { id: "gone" } });
    findUser.mockResolvedValue(null);
    const r = await requireAdmin();
    expect("error" in r && r.error.status).toBe(403);
  });

  it("returns the user id and email for admins (the email is recorded in the audit log)", async () => {
    session.mockResolvedValue({ user: { id: "u1", email: "admin@example.com" } });
    findUser.mockResolvedValue({ role: "ADMIN" });
    expect(await requireAdmin()).toEqual({ userId: "u1", email: "admin@example.com" });
  });

  it("returns a null email when the account has none", async () => {
    session.mockResolvedValue({ user: { id: "u1" } });
    findUser.mockResolvedValue({ role: "ADMIN" });
    expect(await requireAdmin()).toEqual({ userId: "u1", email: null });
  });
});

describe("parseArticle", () => {
  const valid = { title: " Refunds ", content: " Body ", category: " Billing ", tags: ["a", " b ", "a", "", 5] };

  it("trims fields and de-duplicates tags, dropping non-strings", () => {
    expect(parseArticle(valid)).toEqual({
      value: { title: "Refunds", content: "Body", category: "Billing", tags: ["a", "b"] },
    });
  });

  it("treats missing tags as empty", () => {
    expect(parseArticle({ ...valid, tags: undefined })).toMatchObject({ value: { tags: [] } });
  });

  it.each([
    ["missing title", { ...valid, title: "  " }, /Title/],
    ["title too long", { ...valid, title: "x".repeat(201) }, /Title/],
    ["missing category", { ...valid, category: "" }, /Category/],
    ["missing content", { ...valid, content: "" }, /Content/],
    ["content too long", { ...valid, content: "x".repeat(200_001) }, /too long/],
    ["too many tags", { ...valid, tags: Array.from({ length: 21 }, (_, i) => `t${i}`) }, /tags/],
  ])("rejects %s", (_name, body, message) => {
    const r = parseArticle(body);
    expect("error" in r && r.error).toMatch(message);
  });

  it.each([null, undefined, "string", 42])("rejects non-object body %j", (body) => {
    expect("error" in parseArticle(body)).toBe(true);
  });
});

describe("buildSystemPrompt", () => {
  const prompt = buildSystemPrompt([
    { n: 1, title: "Refunds", category: "Billing", content: "Refunds take 5 days." },
    { n: 2, title: "Shipping", category: "Orders", content: "We ship worldwide." },
  ]);

  it("includes numbered excerpts with their titles and categories", () => {
    expect(prompt).toContain("[1] Refunds (Billing)\nRefunds take 5 days.");
    expect(prompt).toContain("[2] Shipping (Orders)\nWe ship worldwide.");
  });

  it("restricts answers to the excerpts, asks for citations and guards against injection", () => {
    expect(prompt).toMatch(/ONLY the knowledge base excerpts/);
    expect(prompt).toMatch(/do not guess/i);
    expect(prompt).toMatch(/cite/i);
    expect(prompt).toMatch(/not instructions/i);
  });
});
