import { NextResponse } from "next/server";
import { exportAccountData } from "@/lib/account-export";
import { getSession } from "@/lib/auth";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Downloads the caller's own data as JSON. POST, so the password isn't put in a URL. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Building the export is a heavy query and the password check is a guessing oracle for a stolen session.
  const limit = await rateLimit(`export:${session.user.id}`, [{ name: "hour", limit: 5, windowSeconds: 3600 }]);
  if (!limit.allowed) return rateLimitResponse(limit, "export requests");

  const body = await req.json().catch(() => null);
  const result = await exportAccountData(session.user.id, { password: body?.password });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });

  return new NextResponse(JSON.stringify(result.data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
