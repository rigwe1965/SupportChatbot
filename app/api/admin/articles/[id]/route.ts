import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
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

  try {
    return NextResponse.json({ data: await updateArticle(params.id, parsed.value) });
  } catch (err) {
    if (isNotFound(err)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    console.error("update article failed", err);
    return NextResponse.json({ error: "Could not save article" }, { status: 502 });
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  try {
    await deleteArticle(params.id);
    return NextResponse.json({ data: { id: params.id } });
  } catch (err) {
    if (isNotFound(err)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    throw err;
  }
}
