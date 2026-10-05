import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: { auditLog: { deleteMany: vi.fn(), create: vi.fn() } } }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

import { GET } from "@/app/api/cron/audit-retention/route";
import { recordAudit } from "@/lib/audit";
import { purgeOldAuditEntries, retentionDays } from "@/lib/audit-retention";
import { db } from "@/lib/db";

const deleteMany = vi.mocked(db.auditLog.deleteMany);
const audit = vi.mocked(recordAudit);

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 5, 1);

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("AUDIT_RETENTION_DAYS", "");
  deleteMany.mockResolvedValue({ count: 0 });
});

describe("retentionDays", () => {
  it.each([
    [undefined, 365],
    ["", 365],
    ["   ", 365],
    ["365", 365],
    ["90", 90],
    ["30", 30],
    ["730", 730],
    [" 120 ", 120],
  ])("%j -> %s days", (value, expected) => {
    vi.stubEnv("AUDIT_RETENTION_DAYS", value as string);
    expect(retentionDays()).toBe(expected);
  });

  it("raises dangerously small values to the 30-day minimum", () => {
    for (const v of ["1", "7", "29"]) {
      vi.stubEnv("AUDIT_RETENTION_DAYS", v);
      expect(retentionDays()).toBe(30);
    }
  });

  it("0 means keep forever", () => {
    vi.stubEnv("AUDIT_RETENTION_DAYS", "0");
    expect(retentionDays()).toBeNull();
  });

  it.each(["abc", "-5", "1.5", "30d", "NaN", "1e3"])("falls back to the default for invalid value %j", (v) => {
    vi.stubEnv("AUDIT_RETENTION_DAYS", v);
    expect(retentionDays()).toBe(365);
  });
});

describe("purgeOldAuditEntries", () => {
  it("deletes only entries older than the cutoff", async () => {
    vi.stubEnv("AUDIT_RETENTION_DAYS", "90");
    await purgeOldAuditEntries(NOW);
    expect(deleteMany).toHaveBeenCalledWith({ where: { createdAt: { lt: new Date(NOW - 90 * DAY) } } });
  });

  it("uses the default retention of a year", async () => {
    const result = await purgeOldAuditEntries(NOW);
    expect(result.retentionDays).toBe(365);
    expect(result.cutoff).toEqual(new Date(NOW - 365 * DAY));
  });

  it("returns how many entries were removed", async () => {
    deleteMany.mockResolvedValue({ count: 42 });
    expect((await purgeOldAuditEntries(NOW)).deleted).toBe(42);
  });

  it("records the purge in the log as the system, with the details", async () => {
    deleteMany.mockResolvedValue({ count: 42 });
    vi.stubEnv("AUDIT_RETENTION_DAYS", "90");
    await purgeOldAuditEntries(NOW);

    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith(
      null,
      expect.objectContaining({
        action: "audit.purge",
        summary: "Deleted 42 audit log entries older than 90 days",
        metadata: { deleted: 42, retentionDays: 90, cutoff: new Date(NOW - 90 * DAY).toISOString() },
      }),
    );
  });

  it("writes the purge note after deleting, so it can't be swept up by its own run", async () => {
    const order: string[] = [];
    deleteMany.mockImplementation((async () => {
      order.push("delete");
      return { count: 1 };
    }) as never);
    audit.mockImplementation((async () => {
      order.push("audit");
    }) as never);
    await purgeOldAuditEntries(NOW);
    expect(order).toEqual(["delete", "audit"]);
  });

  it("uses the singular for a single entry", async () => {
    deleteMany.mockResolvedValue({ count: 1 });
    await purgeOldAuditEntries(NOW);
    expect(audit.mock.calls[0][1].summary).toMatch(/Deleted 1 audit log entry older/);
  });

  it("stays quiet on days when nothing expired", async () => {
    await purgeOldAuditEntries(NOW);
    expect(audit).not.toHaveBeenCalled();
  });

  it("does nothing at all when retention is disabled", async () => {
    vi.stubEnv("AUDIT_RETENTION_DAYS", "0");
    expect(await purgeOldAuditEntries(NOW)).toEqual({ retentionDays: null, cutoff: null, deleted: 0 });
    expect(deleteMany).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("never deletes anything newer than the 30-day floor, even with a tiny setting", async () => {
    vi.stubEnv("AUDIT_RETENTION_DAYS", "1");
    await purgeOldAuditEntries(NOW);
    expect(deleteMany).toHaveBeenCalledWith({ where: { createdAt: { lt: new Date(NOW - 30 * DAY) } } });
  });
});

describe("GET /api/cron/audit-retention", () => {
  const get = (authorization?: string) =>
    GET(new Request("http://localhost/api/cron/audit-retention", { headers: authorization ? { authorization } : {} }));

  it("refuses to run when CRON_SECRET isn't configured (fails closed)", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await get("Bearer anything")).status).toBe(503);
    expect((await get()).status).toBe(503);
    expect(deleteMany).not.toHaveBeenCalled();
  });

  describe("with a secret", () => {
    beforeEach(() => vi.stubEnv("CRON_SECRET", "s3cret"));

    it.each([undefined, "", "s3cret", "Bearer wrong", "Bearer s3cre", "Bearer s3cretx", "bearer s3cret"])(
      "rejects Authorization %j",
      async (header) => {
        expect((await get(header)).status).toBe(401);
        expect(deleteMany).not.toHaveBeenCalled();
      },
    );

    it("runs the purge for the correct bearer token and returns the outcome", async () => {
      deleteMany.mockResolvedValue({ count: 5 });
      const res = await get("Bearer s3cret");

      expect(res.status).toBe(200);
      const { data } = await res.json();
      expect(data).toMatchObject({ retentionDays: 365, deleted: 5 });
      expect(deleteMany).toHaveBeenCalledTimes(1);
    });

    it("returns 500 without leaking details when the purge fails", async () => {
      deleteMany.mockRejectedValue(new Error("connection string postgres://secret"));
      const res = await get("Bearer s3cret");
      expect(res.status).toBe(500);
      expect(await res.text()).not.toContain("postgres://secret");
    });

    it("is safe to run repeatedly", async () => {
      await get("Bearer s3cret");
      await get("Bearer s3cret");
      expect(audit).not.toHaveBeenCalled(); // nothing expired either time
    });
  });
});

describe("vercel.json cron schedule", () => {
  const config = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8")) as {
    crons: { path: string; schedule: string }[];
  };

  it("schedules the retention job daily", () => {
    const job = config.crons.find((c) => c.path === "/api/cron/audit-retention");
    expect(job).toBeDefined();
    expect(job!.schedule).toMatch(/^\d+ \d+ \* \* \*$/); // once a day (also valid on Vercel's Hobby plan)
  });

  it("points every cron at a route that exists", () => {
    for (const { path } of config.crons) {
      expect(existsSync(join(process.cwd(), "app", path, "route.ts")), path).toBe(true);
    }
  });
});
