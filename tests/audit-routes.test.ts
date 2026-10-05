import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/guard", async (original) => ({
  ...(await original<typeof import("@/lib/guard")>()),
  requireAdmin: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/knowledge", () => ({
  createArticle: vi.fn(),
  updateArticle: vi.fn(),
  deleteArticle: vi.fn(),
  reindexArticle: vi.fn(),
}));
vi.mock("@/lib/feedback-review", async (original) => ({
  ...(await original<typeof import("@/lib/feedback-review")>()),
  setReviewed: vi.fn(),
  listNegativeFeedback: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: {
    article: { findUnique: vi.fn(), findMany: vi.fn() },
    ticket: { update: vi.fn() },
  },
}));

import { POST as createRoute } from "@/app/api/admin/articles/route";
import { PUT as updateRoute, DELETE as deleteRoute } from "@/app/api/admin/articles/[id]/route";
import { POST as reindexOneRoute } from "@/app/api/admin/articles/[id]/reindex/route";
import { POST as reindexAllRoute } from "@/app/api/admin/articles/reindex/route";
import { PATCH as resolveRoute } from "@/app/api/admin/tickets/[id]/route";
import { PATCH as reviewRoute } from "@/app/api/admin/feedback/[id]/route";
import { GET as exportRoute } from "@/app/api/admin/feedback/export/route";
import { recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { listNegativeFeedback, setReviewed } from "@/lib/feedback-review";
import { requireAdmin } from "@/lib/guard";
import { createArticle, deleteArticle, reindexArticle, updateArticle } from "@/lib/knowledge";

const audit = vi.mocked(recordAudit);
const admin = { userId: "admin1", email: "admin@example.com" };

const json = (body: unknown, method = "POST") =>
  new Request("http://localhost/x", { method, body: JSON.stringify(body) });
const ctx = (id = "a1") => ({ params: { id } });
const valid = { title: "Refunds", content: "Body", category: "Billing", tags: ["a"] };
const stored = { id: "a1", ...valid };
const notFound = () => new Prisma.PrismaClientKnownRequestError("nope", { code: "P2025", clientVersion: "test" });

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(requireAdmin).mockResolvedValue(admin);
});

describe("every admin route is audited only when it succeeds, as the right admin", () => {
  it("article create", async () => {
    vi.mocked(createArticle).mockResolvedValue(stored as never);
    const req = json(valid);
    expect((await createRoute(req)).status).toBe(201);

    expect(audit).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({
        action: "article.create",
        targetType: "article",
        targetId: "a1",
        summary: 'Created article "Refunds"',
      }),
      req,
    );
  });

  it("article create: not audited when invalid or when embedding fails", async () => {
    expect((await createRoute(json({ title: "" }))).status).toBe(400);
    vi.mocked(createArticle).mockRejectedValue(new Error("openai down"));
    expect((await createRoute(json(valid))).status).toBe(502);
    expect(audit).not.toHaveBeenCalled();
  });

  it("article update: records which fields changed", async () => {
    vi.mocked(db.article.findUnique).mockResolvedValue({ ...stored, content: "Old body", tags: ["a", "b"] } as never);
    vi.mocked(updateArticle).mockResolvedValue(stored as never);

    expect((await updateRoute(json(valid, "PUT"), ctx())).status).toBe(200);
    expect(audit).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({
        action: "article.update",
        summary: 'Updated article "Refunds"',
        metadata: { changed: ["content", "tags"] },
      }),
      expect.anything(),
    );
  });

  it("article update: 404 for a missing article, with no embedding spend and no audit entry", async () => {
    vi.mocked(db.article.findUnique).mockResolvedValue(null);
    expect((await updateRoute(json(valid, "PUT"), ctx())).status).toBe(404);
    expect(updateArticle).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("article delete: records the title of what was deleted", async () => {
    vi.mocked(deleteArticle).mockResolvedValue(stored as never);
    expect((await deleteRoute(json({}, "DELETE"), ctx())).status).toBe(200);
    expect(audit).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({ action: "article.delete", targetId: "a1", summary: 'Deleted article "Refunds"' }),
      expect.anything(),
    );
  });

  it("article delete: nothing logged when it didn't exist", async () => {
    vi.mocked(deleteArticle).mockRejectedValue(notFound());
    expect((await deleteRoute(json({}, "DELETE"), ctx())).status).toBe(404);
    expect(audit).not.toHaveBeenCalled();
  });

  it("single re-embed", async () => {
    vi.mocked(reindexArticle).mockResolvedValue({ title: "Refunds", chunks: 3 });
    expect((await reindexOneRoute(json({}), ctx())).status).toBe(200);
    expect(audit).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({
        action: "article.reindex",
        targetId: "a1",
        summary: 'Regenerated embeddings for "Refunds"',
        metadata: { chunks: 3 },
      }),
      expect.anything(),
    );
  });

  it("single re-embed: nothing logged on failure", async () => {
    vi.mocked(reindexArticle).mockRejectedValue(new Error("openai down"));
    expect((await reindexOneRoute(json({}), ctx())).status).toBe(502);
    expect(audit).not.toHaveBeenCalled();
  });

  it("re-embed all: logs the outcome including failures", async () => {
    vi.mocked(db.article.findMany).mockResolvedValue([{ id: "a1" }, { id: "a2" }, { id: "a3" }] as never);
    vi.mocked(reindexArticle)
      .mockResolvedValueOnce({ title: "A", chunks: 1 })
      .mockRejectedValueOnce(new Error("x"))
      .mockResolvedValueOnce({ title: "C", chunks: 1 });

    await reindexAllRoute(json({}));
    expect(audit).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({
        action: "article.reindex_all",
        summary: "Regenerated embeddings for 2 articles (1 failed)",
        metadata: { reindexed: 2, failed: 1 },
      }),
      expect.anything(),
    );
  });

  it("ticket resolve", async () => {
    vi.mocked(db.ticket.update).mockResolvedValue({ id: "ckabcdef123456", reason: "HUMAN_REQUESTED" } as never);
    expect((await resolveRoute(json({}, "PATCH"), ctx("ckabcdef123456"))).status).toBe(200);
    expect(audit).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({
        action: "ticket.resolve",
        targetType: "ticket",
        targetId: "ckabcdef123456",
        summary: "Resolved ticket #123456",
      }),
      expect.anything(),
    );
  });

  it("ticket resolve: nothing logged for an unknown ticket", async () => {
    vi.mocked(db.ticket.update).mockRejectedValue(notFound());
    expect((await resolveRoute(json({}, "PATCH"), ctx("nope"))).status).toBe(404);
    expect(audit).not.toHaveBeenCalled();
  });

  it("feedback review and reopen are distinct actions", async () => {
    vi.mocked(setReviewed).mockResolvedValue(true);
    await reviewRoute(json({ reviewed: true }, "PATCH"), ctx("m1"));
    await reviewRoute(json({ reviewed: false }, "PATCH"), ctx("m1"));

    expect(audit.mock.calls.map((c) => c[1].action)).toEqual(["feedback.review", "feedback.reopen"]);
    expect(audit.mock.calls[0][1]).toMatchObject({ targetType: "message", targetId: "m1" });
  });

  it("feedback review: nothing logged when invalid or unknown", async () => {
    expect((await reviewRoute(json({ reviewed: "yes" }, "PATCH"), ctx("m1"))).status).toBe(400);
    vi.mocked(setReviewed).mockResolvedValue(false);
    expect((await reviewRoute(json({ reviewed: true }, "PATCH"), ctx("m1"))).status).toBe(404);
    expect(audit).not.toHaveBeenCalled();
  });

  it("feedback export: always logged, with the row count", async () => {
    const row = {
      id: "m",
      conversationId: "c",
      question: null,
      answer: "a",
      comment: null,
      sources: [],
      feedbackAt: new Date(),
      reviewedAt: null,
      userName: null,
      userEmail: null,
    };
    vi.mocked(listNegativeFeedback).mockResolvedValue([row, row, row]);
    const res = await exportRoute(new Request("http://localhost/api/admin/feedback/export?status=reviewed"));
    expect(res.status).toBe(200);
    expect(audit).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({
        action: "feedback.export",
        summary: "Exported 3 feedback rows (reviewed) as CSV",
        metadata: { status: "reviewed", rows: 3 },
      }),
      expect.anything(),
    );
  });
});

describe("non-admins", () => {
  it("cannot act, and nothing is logged", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    });
    const responses = await Promise.all([
      createRoute(json(valid)),
      updateRoute(json(valid, "PUT"), ctx()),
      deleteRoute(json({}, "DELETE"), ctx()),
      reindexOneRoute(json({}), ctx()),
      reindexAllRoute(json({})),
      resolveRoute(json({}, "PATCH"), ctx()),
      reviewRoute(json({ reviewed: true }, "PATCH"), ctx()),
      exportRoute(new Request("http://localhost/x")),
    ]);
    expect(responses.map((r) => r.status)).toEqual(Array(8).fill(403));
    expect(audit).not.toHaveBeenCalled();
  });
});
