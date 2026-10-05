import { NextResponse } from "next/server";
import { normalizeEmail, requestPasswordReset } from "@/lib/account";
import { ipFromHeaders } from "@/lib/ip";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";

const HOUR = 3600;

export async function POST(req: Request) {
  const ip = ipFromHeaders(req.headers) ?? "unknown";
  const byIp = await rateLimit(`forgot:ip:${ip}`, [{ name: "hour", limit: 5, windowSeconds: HOUR }]);
  if (!byIp.allowed) return rateLimitResponse(byIp, "reset requests");

  const body = await req.json().catch(() => null);
  const email = normalizeEmail(body?.email);
  if (!email) return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });

  const byEmail = await rateLimit(`forgot:email:${email}`, [{ name: "hour", limit: 3, windowSeconds: HOUR }]);
  if (!byEmail.allowed) return rateLimitResponse(byEmail, "reset requests");

  await requestPasswordReset(email);
  // Identical response whether or not an account exists, so this can't be used to look up users.
  return NextResponse.json({ data: { ok: true } });
}
