import { NextResponse } from "next/server";
import { requireAdmin, parseArticle } from "@/lib/guard";
import { createArticle } from "@/lib/knowledge";
import { db } from "@/lib/db";

export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const articles = await db.article.findMany({
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, category: true, tags: true, updatedAt: true },
  });
  return NextResponse.json({ data: articles });
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const parsed = parseArticle(await req.json().catch(() => null));
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const article = await createArticle(parsed.value, auth.userId);
    return NextResponse.json({ data: article }, { status: 201 });
  } catch (err) {
    console.error("create article failed", err);
    return NextResponse.json({ error: "Could not save article" }, { status: 502 });
  }
}
