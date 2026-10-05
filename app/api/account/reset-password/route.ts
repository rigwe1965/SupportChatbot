import { NextResponse } from "next/server";
import { resetPassword } from "@/lib/account";
import { ipFromHeaders } from "@/lib/ip";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";

export async function POST(req: Request) {
  const ip = ipFromHeaders(req.headers) ?? "unknown";
  const limit = await rateLimit(`reset:ip:${ip}`, [{ name: "hour", limit: 10, windowSeconds: 3600 }]);
  if (!limit.allowed) return rateLimitResponse(limit, "attempts");

  const body = await req.json().catch(() => null);
  if (typeof body?.token !== "string" || !body.token) {
    return NextResponse.json({ error: "This link is invalid or has expired." }, { status: 400 });
  }

  const result = await resetPassword(body.token, body.password);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ data: { ok: true } });
}
