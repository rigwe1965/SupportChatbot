import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export type AuditAction =
  | "article.create"
  | "article.update"
  | "article.delete"
  | "article.reindex"
  | "article.reindex_all"
  | "ticket.resolve"
  | "feedback.review"
  | "feedback.reopen"
  | "feedback.export"
  | "user.promoted_admin"
  | "audit.purge";

export interface AuditEntry {
  action: AuditAction;
  targetType?: "article" | "ticket" | "message" | "user";
  targetId?: string;
  /** Human-readable, written at the time of the action (e.g. `Deleted article "Refund policy"`). */
  summary: string;
  /** Small structured details. Never put secrets or full article/customer content here. */
  metadata?: Prisma.InputJsonValue;
}

export interface AuditActor {
  userId: string;
  email?: string | null;
}

/** Best-effort client IP. On Vercel the first x-forwarded-for entry is set by the platform. */
export function clientIp(req?: Request): string | null {
  const forwarded = req?.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req?.headers.get("x-real-ip")?.trim() || null;
}

/**
 * Appends an entry to the audit log. Call it after the action succeeded.
 *
 * Best-effort: a failure to write is logged but never turns a completed admin action into an error.
 */
export async function recordAudit(actor: AuditActor | null, entry: AuditEntry, req?: Request): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        actorId: actor?.userId ?? null,
        // A null actor is the system itself (e.g. the retention job).
        actorEmail: actor ? (actor.email ?? null) : "system",
        action: entry.action,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        summary: entry.summary,
        metadata: entry.metadata,
        ip: clientIp(req),
      },
    });
  } catch (err) {
    console.error("audit log write failed", entry.action, err);
  }
}

export const AUDIT_CATEGORIES = [
  { key: "all", label: "All" },
  { key: "article", label: "Articles" },
  { key: "ticket", label: "Tickets" },
  { key: "feedback", label: "Feedback" },
  { key: "user", label: "Users" },
  { key: "audit", label: "Retention" },
] as const;

export type AuditCategory = (typeof AUDIT_CATEGORIES)[number]["key"];

export const parseAuditCategory = (v: string | null | undefined): AuditCategory =>
  AUDIT_CATEGORIES.find((c) => c.key === v)?.key ?? "all";

export const AUDIT_PAGE_SIZE = 50;

export interface AuditPage {
  entries: {
    id: string;
    createdAt: Date;
    actorEmail: string | null;
    action: string;
    targetType: string | null;
    targetId: string | null;
    summary: string;
    ip: string | null;
  }[];
  hasMore: boolean;
}

/** One page of the log, newest first, optionally limited to a category such as "article". */
export async function listAudit(category: AuditCategory, page: number): Promise<AuditPage> {
  const safePage = Number.isInteger(page) && page > 0 ? page : 1;
  const rows = await db.auditLog.findMany({
    where: category === "all" ? {} : { action: { startsWith: `${category}.` } },
    orderBy: { createdAt: "desc" },
    skip: (safePage - 1) * AUDIT_PAGE_SIZE,
    take: AUDIT_PAGE_SIZE + 1, // one extra row tells us whether there is a next page
    select: {
      id: true,
      createdAt: true,
      actorEmail: true,
      action: true,
      targetType: true,
      targetId: true,
      summary: true,
      ip: true,
    },
  });
  return { entries: rows.slice(0, AUDIT_PAGE_SIZE), hasMore: rows.length > AUDIT_PAGE_SIZE };
}
