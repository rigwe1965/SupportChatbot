import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import type { ArticleInput } from "@/types";

/** For API routes: returns the admin's user id, or a ready-made error response. */
export async function requireAdmin(): Promise<{ userId: string } | { error: NextResponse }> {
  const session = await getSession();
  if (!session) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  // Check the DB rather than the JWT so role changes apply immediately.
  const user = await db.user.findUnique({ where: { id: session.user.id }, select: { role: true } });
  if (user?.role !== "ADMIN") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { userId: session.user.id };
}

/** Validates an article request body; returns the clean input or an error message. */
export function parseArticle(body: unknown): { value: ArticleInput } | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const title = typeof b.title === "string" ? b.title.trim() : "";
  const content = typeof b.content === "string" ? b.content.trim() : "";
  const category = typeof b.category === "string" ? b.category.trim() : "";
  const rawTags = Array.isArray(b.tags) ? b.tags : [];
  const tags = Array.from(
    new Set(rawTags.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter(Boolean)),
  );

  if (!title || title.length > 200) return { error: "Title is required (max 200 characters)" };
  if (!category || category.length > 100) return { error: "Category is required (max 100 characters)" };
  if (!content) return { error: "Content is required" };
  if (content.length > 200_000) return { error: "Content is too long (max 200,000 characters)" };
  if (tags.length > 20) return { error: "At most 20 tags" };
  return { value: { title, content, category, tags } };
}
