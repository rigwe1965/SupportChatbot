import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/guard", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    $queryRaw: vi.fn(),
    message: { count: vi.fn(), updateMany: vi.fn() },
  },
}));

import { PATCH } from "@/app/api/admin/feedback/[id]/route";
import { db } from "@/lib/db";
import { countUnreviewedNegative, listNegativeFeedback, setReviewed } from "@/lib/feedback-review";
import { requireAdmin } from "@/lib/guard";
import { NextResponse } from "next/server";

const adminCheck = vi.mocked(requireAdmin);
const query = vi.mocked(db.$queryRaw);
const updateMany = vi.mocked(db.message.updateMany);
const count = vi.mocked(db.message.count);

const row = (over = {}) => ({
  id: "m1",
  conversationId: "c1",
  question: "How do refunds work?",
  answer: "Refunds take 5 days [1].",
  comment: "Wrong, it is 10 days",
  sources: [{ n: 1, title: "Refund policy", category: "Billing", snippet: "…", similarity: 0.6 }],
  feedbackAt: new Date("2026-01-02T00:00:00Z"),
  reviewedAt: null,
  userName: "Ada",
  userEmail: "ada@example.com",
  ...over,
});

/** The SQL text of the status filter passed into the tagged-template query. */
const filterSql = () => {
  // Prisma's Sql class isn't exported at runtime, so recognise fragments by shape.
  const fragment = query.mock.calls[0]
    .slice(1)
    .find((v) => typeof v === "object" && v !== null && "sql" in v) as { sql: string } | undefined;
  return fragment?.sql ?? "";
};
const fullSql = () => (query.mock.calls[0][0] as unknown as string[]).join("?");

beforeEach(() => {
  vi.resetAllMocks();
  adminCheck.mockResolvedValue({ userId: "admin1" });
});

describe("listNegativeFeedback", () => {
  it("only asks for thumbs-down answers from assistant messages, newest first, with the question they answered", async () => {
    query.mockResolvedValue([]);
    await listNegativeFeedback("all");
    const sql = fullSql();
    expect(sql).toMatch(/"feedback" = 'DOWN'/);
    expect(sql).toMatch(/"role" = 'assistant'/);
    expect(sql).toMatch(/ORDER BY m\."feedbackAt" DESC/);
    expect(sql).toMatch(/LEFT JOIN LATERAL/); // the preceding customer message
  });

  it("filters to unreviewed items for the review queue", async () => {
    query.mockResolvedValue([]);
    await listNegativeFeedback("todo");
    expect(filterSql()).toMatch(/"feedbackReviewedAt" IS NULL/);
  });

  it("filters to reviewed items", async () => {
    query.mockResolvedValue([]);
    await listNegativeFeedback("reviewed");
    expect(filterSql()).toMatch(/IS NOT NULL/);
  });

  it("applies no review filter for 'all'", async () => {
    query.mockResolvedValue([]);
    await listNegativeFeedback("all");
    expect(filterSql()).toBe("");
  });

  it("limits the result size", async () => {
    query.mockResolvedValue([]);
    await listNegativeFeedback("todo");
    expect(query.mock.calls[0].slice(1)).toContain(100);
  });

  it("maps rows and reduces cited sources to title + category", async () => {
    query.mockResolvedValue([row()] as never);
    const [item] = await listNegativeFeedback("todo");
    expect(item).toMatchObject({
      id: "m1",
      question: "How do refunds work?",
      answer: "Refunds take 5 days [1].",
      comment: "Wrong, it is 10 days",
      sources: [{ title: "Refund policy", category: "Billing" }],
      userEmail: "ada@example.com",
    });
    expect(item.sources[0]).not.toHaveProperty("snippet");
  });

  it("treats missing, empty or malformed sources as 'nothing matched'", async () => {
    query.mockResolvedValue([
      row({ sources: null }),
      row({ sources: [] }),
      row({ sources: "oops" }),
      row({ sources: [{ category: "x" }, null] }),
    ] as never);
    const items = await listNegativeFeedback("todo");
    expect(items.map((i) => i.sources)).toEqual([[], [], [], []]);
  });

  it("keeps rows without a reason or a matching question", async () => {
    query.mockResolvedValue([row({ comment: null, question: null })] as never);
    const [item] = await listNegativeFeedback("todo");
    expect(item.comment).toBeNull();
    expect(item.question).toBeNull();
  });
});

describe("countUnreviewedNegative", () => {
  it("counts assistant thumbs-downs nobody has reviewed", async () => {
    count.mockResolvedValue(3);
    expect(await countUnreviewedNegative()).toBe(3);
    expect(count).toHaveBeenCalledWith({
      where: { role: "assistant", feedback: "DOWN", feedbackReviewedAt: null },
    });
  });
});

describe("setReviewed", () => {
  it("stamps the review time, only for thumbs-down assistant messages", async () => {
    updateMany.mockResolvedValue({ count: 1 });
    expect(await setReviewed("m1", true)).toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "m1", role: "assistant", feedback: "DOWN" },
      data: { feedbackReviewedAt: expect.any(Date) },
    });
  });

  it("clears the stamp when reopening", async () => {
    updateMany.mockResolvedValue({ count: 1 });
    await setReviewed("m1", false);
    expect(updateMany.mock.calls[0][0].data).toEqual({ feedbackReviewedAt: null });
  });

  it("returns false when nothing matched", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    expect(await setReviewed("nope", true)).toBe(false);
  });
});

describe("PATCH /api/admin/feedback/[id]", () => {
  const patch = (body: unknown, id = "m1") =>
    PATCH(new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify(body) }), { params: { id } });

  it("is admin-only and does nothing for non-admins", async () => {
    adminCheck.mockResolvedValue({ error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) });
    expect((await patch({ reviewed: true })).status).toBe(403);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it.each([{}, { reviewed: "yes" }, { reviewed: 1 }, null])("rejects body %j", async (body) => {
    expect((await patch(body)).status).toBe(400);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("returns 404 for unknown messages or ones that aren't thumbs-down", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    expect((await patch({ reviewed: true })).status).toBe(404);
  });

  it("marks reviewed and reopens", async () => {
    updateMany.mockResolvedValue({ count: 1 });

    const done = await patch({ reviewed: true });
    expect(done.status).toBe(200);
    expect(await done.json()).toEqual({ data: { id: "m1", reviewed: true } });

    await patch({ reviewed: false });
    expect(updateMany.mock.calls[1][0].data).toEqual({ feedbackReviewedAt: null });
  });
});
