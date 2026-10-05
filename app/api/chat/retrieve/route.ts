import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { retrieve } from "@/lib/knowledge";
import { chatRules, rateLimit, rateLimitHeaders, rateLimitResponse } from "@/lib/rate-limit";

const TOP_K = 5;

export async function POST(req: Request) {
  // Each call spends embedding credits, so require a signed-in user.
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const limit = await rateLimit(`retrieve:${session.user.id}`, chatRules());
  if (!limit.allowed) return rateLimitResponse(limit);

  const body = await req.json().catch(() => null);
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (!question || question.length > 2000) {
    return NextResponse.json(
      { error: "`question` is required (max 2000 characters)" },
      { status: 400 },
    );
  }

  try {
    const results = await retrieve(question, TOP_K);
    return NextResponse.json({ data: results }, { headers: rateLimitHeaders(limit) });
  } catch (err) {
    console.error("retrieve failed", err);
    return NextResponse.json({ error: "Retrieval failed" }, { status: 502 });
  }
}
