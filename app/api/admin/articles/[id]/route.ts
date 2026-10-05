import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { recordAudit } from "@/lib/audit";
import { requireAdmin, parseArticle } from "@/lib/guard";
import { deleteArticle, updateArticle } from "@/lib/knowledge";
import { db } from "@/lib/db";

type Ctx = { params: { id: string } };

const isNotFound = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025";

export async function GET(_req: Request, { params }: Ctx) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const article = await db.article.findUnique({ where: { id: params.id } });
  if (!article) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ data: article });
}

export async function PUT(req: Request, { params }: Ctx) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const parsed = parseArticle(await req.json().catch(() => null));
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  // Needed to record which fields changed (and to avoid paying for embeddings on a missing article).
  const before = await db.article.findUnique({ where: { id: params.id } });
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const article = await updateArticle(params.id, parsed.value);
    const next = parsed.value;
    const changed = [
      before.title !== next.title && "title",
      before.category !== next.category && "category",
      before.content !== next.content && "content",
      JSON.stringify(before.tags) !== JSON.stringify(next.tags) && "tags",
    ].filter(Boolean) as string[];

    await recordAudit(
      auth,
      {
        action: "article.update",
        targetType: "article",
        targetId: article.id,
        summary: `Updated article "${article.title}"`,
        metadata: { changed },
      },
      req,
    );
    return NextResponse.json({ data: article });
  } catch (err) {
    if (isNotFound(err)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    console.error("update article failed", err);
    return NextResponse.json({ error: "Could not save article" }, { status: 502 });
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  try {
    const deleted = await deleteArticle(params.id);
    await recordAudit(
      auth,
      {
        action: "article.delete",
        targetType: "article",
        targetId: deleted.id,
        summary: `Deleted article "${deleted.title}"`,
        metadata: { category: deleted.category },
      },
      req,
    );
    return NextResponse.json({ data: { id: params.id } });
  } catch (err) {
    if (isNotFound(err)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    throw err;
  }
}
