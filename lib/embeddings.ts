const MODEL = process.env.EMBEDDING_MODEL ?? "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536; // must match vector(1536) in the schema
const BATCH_SIZE = 96;

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: MODEL, input: texts.slice(i, i + BATCH_SIZE) }),
    });
    if (!res.ok) throw new Error(`OpenAI embeddings failed (${res.status}): ${await res.text()}`);
    const json = (await res.json()) as { data: { index: number; embedding: number[] }[] };
    json.data.sort((a, b) => a.index - b.index).forEach((d) => out.push(d.embedding));
  }
  return out;
}

export async function embedText(text: string): Promise<number[]> {
  return (await embedTexts([text]))[0];
}

/** pgvector text literal, e.g. "[0.1,0.2]" — cast with ::vector in SQL. */
export const toVectorLiteral = (v: number[]) => `[${v.join(",")}]`;
