import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: { auditLog: { create: vi.fn(), findMany: vi.fn() } },
}));

import { db } from "@/lib/db";
import {
  AUDIT_PAGE_SIZE,
  clientIp,
  listAudit,
  parseAuditCategory,
  recordAudit,
} from "@/lib/audit";

const create = vi.mocked(db.auditLog.create);
const findMany = vi.mocked(db.auditLog.findMany);

const req = (headers: Record<string, string> = {}) => new Request("http://localhost/x", { headers });

beforeEach(() => {
  vi.resetAllMocks();
  create.mockResolvedValue({} as never);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("clientIp", () => {
  it("uses the first x-forwarded-for entry", () => {
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.5, 10.0.0.1, 10.0.0.2" }))).toBe("203.0.113.5");
  });
  it("falls back to x-real-ip", () => {
    expect(clientIp(req({ "x-real-ip": "198.51.100.7" }))).toBe("198.51.100.7");
  });
  it("is null without headers or a request", () => {
    expect(clientIp(req())).toBeNull();
    expect(clientIp(undefined)).toBeNull();
  });
});

describe("recordAudit", () => {
  const actor = { userId: "u1", email: "admin@example.com" };

  it("writes who, what, which object, a summary and the client IP", async () => {
    await recordAudit(
      actor,
      {
        action: "article.delete",
        targetType: "article",
        targetId: "a1",
        summary: 'Deleted article "Refunds"',
        metadata: { category: "Billing" },
      },
      req({ "x-forwarded-for": "203.0.113.5" }),
    );

    expect(create).toHaveBeenCalledWith({
      data: {
        actorId: "u1",
        actorEmail: "admin@example.com",
        action: "article.delete",
        targetType: "article",
        targetId: "a1",
        summary: 'Deleted article "Refunds"',
        metadata: { category: "Billing" },
        ip: "203.0.113.5",
      },
    });
  });

  it("stores nulls for optional fields", async () => {
    await recordAudit({ userId: "u1" }, { action: "article.reindex_all", summary: "Regenerated" });
    expect(create.mock.calls[0][0].data).toMatchObject({
      actorEmail: null,
      targetType: null,
      targetId: null,
      ip: null,
    });
  });

  it("never throws, so a logging failure can't undo an admin action", async () => {
    create.mockRejectedValue(new Error("db down"));
    await expect(recordAudit(actor, { action: "ticket.resolve", summary: "x" })).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});

describe("parseAuditCategory", () => {
  it.each([
    ["article", "article"],
    ["ticket", "ticket"],
    ["feedback", "feedback"],
    ["user", "user"],
    ["all", "all"],
    ["nope", "all"],
    ["", "all"],
    [null, "all"],
    [undefined, "all"],
  ])("%j -> %s", (input, expected) => {
    expect(parseAuditCategory(input as string | null)).toBe(expected);
  });
});

describe("listAudit", () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `e${i}` }));

  it("returns newest first and filters a category by action prefix", async () => {
    findMany.mockResolvedValue([] as never);
    await listAudit("article", 1);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { action: { startsWith: "article." } },
        orderBy: { createdAt: "desc" },
      }),
    );
  });

  it("applies no filter for 'all'", async () => {
    findMany.mockResolvedValue([] as never);
    await listAudit("all", 1);
    expect(findMany.mock.calls[0][0]?.where).toEqual({});
  });

  it("pages with skip/take and reads one extra row to detect a next page", async () => {
    findMany.mockResolvedValue(rows(AUDIT_PAGE_SIZE + 1) as never);
    const page = await listAudit("all", 3);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 2 * AUDIT_PAGE_SIZE, take: AUDIT_PAGE_SIZE + 1 }),
    );
    expect(page.entries).toHaveLength(AUDIT_PAGE_SIZE);
    expect(page.hasMore).toBe(true);
  });

  it("reports no next page on the last page", async () => {
    findMany.mockResolvedValue(rows(10) as never);
    const page = await listAudit("all", 1);
    expect(page.entries).toHaveLength(10);
    expect(page.hasMore).toBe(false);
  });

  it.each([0, -1, 1.5, Number.NaN])("treats page %s as page 1", async (p) => {
    findMany.mockResolvedValue([] as never);
    await listAudit("all", p);
    expect(findMany.mock.calls[0][0]?.skip).toBe(0);
  });
});
