import { NextResponse } from "next/server";
import { normalizeEmail, registerUser } from "@/lib/account";
import { ipFromHeaders } from "@/lib/ip";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";

const HOUR = 3600;

export async function POST(req: Request) {
  const ip = ipFromHeaders(req.headers) ?? "unknown";
  const byIp = await rateLimit(`register:ip:${ip}`, [{ name: "hour", limit: 10, windowSeconds: HOUR }]);
  if (!byIp.allowed) return rateLimitResponse(byIp, "sign-up attempts");

  const body = await req.json().catch(() => null);

  // Also cap per address so the form can't be used to mail-bomb someone.
  const email = normalizeEmail(body?.email);
  if (email) {
    const byEmail = await rateLimit(`register:email:${email}`, [{ name: "hour", limit: 3, windowSeconds: HOUR }]);
    if (!byEmail.allowed) return rateLimitResponse(byEmail, "sign-up attempts");
  }

  const result = await registerUser({ name: body?.name, email: body?.email, password: body?.password });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  // Same answer whether or not the address already had an account.
  return NextResponse.json({ data: { ok: true } });
}
