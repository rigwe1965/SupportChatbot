import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { chunkText } from "@/lib/chunk";
import { embedText, embedTexts, toVectorLiteral } from "@/lib/embeddings";
import type { ArticleInput, RetrievedChunk } from "@/types";

/** Chunks and embeds an article. Done before any DB write so a failure leaves no half-indexed state. */
async function buildChunks(input: ArticleInput) {
  const pieces = chunkText(input.content);
  // Prefix the title/category so each chunk is meaningful on its own.
  const vectors = await embedTexts(
    pieces.map((p) => `${input.title} (${input.category})\n\n${p}`),
  );
  return pieces.map((content, index) => ({
    id: randomUUID(),
    index,
    content,
    embedding: toVectorLiteral(vectors[index]),
  }));
}

function insertChunks(
  tx: Prisma.TransactionClient,
  articleId: string,
  chunks: Awaited<ReturnType<typeof buildChunks>>,
) {
  return Promise.all(
    chunks.map(
      (c) => tx.$executeRaw`
        INSERT INTO "ArticleChunk" ("id", "articleId", "index", "content", "embedding")
        VALUES (${c.id}, ${articleId}, ${c.index}, ${c.content}, ${c.embedding}::vector)`,
    ),
  );
}

export async function createArticle(input: ArticleInput, authorId: string) {
  const chunks = await buildChunks(input);
  return db.$transaction(async (tx) => {
    const article = await tx.article.create({ data: { ...input, authorId } });
    await insertChunks(tx, article.id, chunks);
    return article;
  });
}

export async function updateArticle(id: string, input: ArticleInput) {
  const chunks = await buildChunks(input);
  return db.$transaction(async (tx) => {
    const article = await tx.article.update({ where: { id }, data: input });
    await tx.articleChunk.deleteMany({ where: { articleId: id } });
    await insertChunks(tx, id, chunks);
    return article;
  });
}

export const deleteArticle = (id: string) => db.article.delete({ where: { id } });

/** Embeds the question and returns the closest chunks by cosine similarity (1 = identical). */
export async function retrieve(question: string, limit = 5): Promise<RetrievedChunk[]> {
  const q = toVectorLiteral(await embedText(question));
  return db.$queryRaw<RetrievedChunk[]>`
    SELECT c."id" AS "chunkId",
           c."articleId",
           a."title",
           a."category",
           c."content",
           (1 - (c."embedding" <=> ${q}::vector))::float8 AS "similarity"
    FROM "ArticleChunk" c
    JOIN "Article" a ON a."id" = c."articleId"
    ORDER BY c."embedding" <=> ${q}::vector
    LIMIT ${limit}`;
}

/** Re-chunks and re-embeds an article from its stored content (e.g. after changing the embedding model). */
export async function reindexArticle(id: string) {
  const article = await db.article.findUniqueOrThrow({ where: { id } });
  const chunks = await buildChunks(article);
  await db.$transaction(async (tx) => {
    await tx.articleChunk.deleteMany({ where: { articleId: id } });
    await insertChunks(tx, id, chunks);
  });
  return { title: article.title, chunks: chunks.length };
}
