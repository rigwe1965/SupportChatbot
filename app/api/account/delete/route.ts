import { NextResponse } from "next/server";
import { deleteAccount } from "@/lib/account-deletion";
import { getSession } from "@/lib/auth";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Permanently deletes the caller's own account. There is no way to delete anyone else's. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // The password check below is a guessing oracle for anyone holding a stolen session.
  const limit = await rateLimit(`delete:${session.user.id}`, [{ name: "hour", limit: 5, windowSeconds: 3600 }]);
  if (!limit.allowed) return rateLimitResponse(limit, "deletion attempts");

  const body = await req.json().catch(() => null);
  const result = await deleteAccount(session.user.id, { password: body?.password, confirm: body?.confirm }, req);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ data: { ok: true } });
}
