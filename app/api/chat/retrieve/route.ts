import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { retrieve } from "@/lib/knowledge";

const TOP_K = 5;

export async function POST(req: Request) {
  // Each call spends embedding credits, so require a signed-in user.
  if (!(await getSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
    return NextResponse.json({ data: results });
  } catch (err) {
    console.error("retrieve failed", err);
    return NextResponse.json({ error: "Retrieval failed" }, { status: 502 });
  }
}
