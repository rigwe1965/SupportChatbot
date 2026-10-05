import { recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";

export const DEFAULT_RETENTION_DAYS = 365;
/** Guards against a typo (e.g. 1) wiping the log. */
export const MIN_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long audit entries are kept, from AUDIT_RETENTION_DAYS.
 *  - unset / invalid → 365 days
 *  - 0 → keep forever (returns null)
 *  - anything from 1 to 29 → raised to 30
 */
export function retentionDays(): number | null {
  const raw = process.env.AUDIT_RETENTION_DAYS?.trim();
  if (!raw) return DEFAULT_RETENTION_DAYS;
  if (!/^\d+$/.test(raw)) return DEFAULT_RETENTION_DAYS;
  const days = Number.parseInt(raw, 10);
  if (days === 0) return null;
  return Math.max(days, MIN_RETENTION_DAYS);
}

export interface PurgeResult {
  /** null when retention is disabled (entries are kept forever). */
  retentionDays: number | null;
  cutoff: Date | null;
  deleted: number;
}

/** Deletes audit entries older than the retention period and leaves a note about it in the log. */
export async function purgeOldAuditEntries(now: number = Date.now()): Promise<PurgeResult> {
  const days = retentionDays();
  if (days === null) return { retentionDays: null, cutoff: null, deleted: 0 };

  const cutoff = new Date(now - days * DAY_MS);
  const { count } = await db.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } });

  // Deleting audit data is itself worth recording. Skip the noise on days when nothing expired.
  if (count > 0) {
    await recordAudit(null, {
      action: "audit.purge",
      summary: `Deleted ${count} audit log entr${count === 1 ? "y" : "ies"} older than ${days} days`,
      metadata: { deleted: count, retentionDays: days, cutoff: cutoff.toISOString() },
    });
  }
  return { retentionDays: days, cutoff, deleted: count };
}
