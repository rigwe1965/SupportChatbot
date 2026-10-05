import { NextResponse } from "next/server";
import { changePassword } from "@/lib/account";
import { getSession } from "@/lib/auth";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // The current-password check is a guessing oracle for anyone holding a stolen session.
  const limit = await rateLimit(`change-password:${session.user.id}`, [{ name: "hour", limit: 5, windowSeconds: 3600 }]);
  if (!limit.allowed) return rateLimitResponse(limit, "password change attempts");

  const body = await req.json().catch(() => null);
  const result = await changePassword(session.user.id, body?.currentPassword, body?.newPassword);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ data: { ok: true } });
}
