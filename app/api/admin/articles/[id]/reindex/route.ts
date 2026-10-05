import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { recordAudit } from "@/lib/audit";
import { requireAdmin } from "@/lib/guard";
import { reindexArticle } from "@/lib/knowledge";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  try {
    const { title, chunks } = await reindexArticle(params.id);
    await recordAudit(
      auth,
      {
        action: "article.reindex",
        targetType: "article",
        targetId: params.id,
        summary: `Regenerated embeddings for "${title}"`,
        metadata: { chunks },
      },
      req,
    );
    return NextResponse.json({ data: { chunks } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    console.error("reindex failed", err);
    return NextResponse.json({ error: "Could not regenerate embeddings" }, { status: 502 });
  }
}
