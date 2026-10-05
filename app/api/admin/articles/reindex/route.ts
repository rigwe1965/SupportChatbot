import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/guard";
import { reindexArticle } from "@/lib/knowledge";

export const maxDuration = 60;

/** Regenerates embeddings for every article, one at a time. */
export async function POST() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const articles = await db.article.findMany({ select: { id: true } });
  let reindexed = 0;
  const failed: string[] = [];
  for (const { id } of articles) {
    try {
      await reindexArticle(id);
      reindexed++;
    } catch (err) {
      console.error("reindex failed for", id, err);
      failed.push(id);
    }
  }
  return NextResponse.json({ data: { reindexed, failed: failed.length } });
}
