import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { purgeOldAuditEntries } from "@/lib/audit-retention";

export const dynamic = "force-dynamic";

/**
 * Daily job (see vercel.json) that deletes expired audit log entries.
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET`; anything else is rejected.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Fail closed: without a secret anyone on the internet could trigger the purge.
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  }

  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return NextResponse.json({ data: await purgeOldAuditEntries() });
  } catch (err) {
    console.error("audit retention failed", err);
    return NextResponse.json({ error: "Retention job failed" }, { status: 500 });
  }
}
