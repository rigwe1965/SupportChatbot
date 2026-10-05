import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Invalidates every session of the caller, on every device, including this one. */
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limit = await rateLimit(`sign-out-everywhere:${session.user.id}`, [{ name: "hour", limit: 10, windowSeconds: 3600 }]);
  if (!limit.allowed) return rateLimitResponse(limit, "requests");

  await db.user.update({ where: { id: session.user.id }, data: { sessionsValidFrom: new Date() } });
  return NextResponse.json({ data: { ok: true } });
}
