import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { streamChat } from "@/lib/openai-chat";
import { embedText, embedTexts, toVectorLiteral } from "@/lib/embeddings";

const fetchMock = vi.fn();

/** A streamed Response whose body arrives in the given raw pieces. */
function sse(pieces: string[], status = 200) {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(c) {
        pieces.forEach((p) => c.enqueue(enc.encode(p)));
        c.close();
      },
    }),
    { status },
  );
}
const delta = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;

async function collect(gen: AsyncGenerator<string>) {
  const out: string[] = [];
  for await (const t of gen) out.push(t);
  return out;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("OPENAI_API_KEY", "sk-test");
});
afterEach(() => vi.unstubAllGlobals());

describe("streamChat", () => {
  const messages = [{ role: "user" as const, content: "hi" }];

  it("yields content deltas in order and stops at [DONE]", async () => {
    fetchMock.mockResolvedValue(sse([delta("Hel"), delta("lo"), "data: [DONE]\n\n", delta("ignored")]));
    expect(await collect(streamChat(messages))).toEqual(["Hel", "lo"]);
  });

  it("reassembles events split across network chunks", async () => {
    const full = delta("Hello");
    fetchMock.mockResolvedValue(sse([full.slice(0, 15), full.slice(15, 40), full.slice(40), "data: [DONE]\n\n"]));
    expect(await collect(streamChat(messages))).toEqual(["Hello"]);
  });

  it("skips role-only, empty and malformed events", async () => {
    fetchMock.mockResolvedValue(
      sse([
        `data: ${JSON.stringify({ choices: [{ delta: { role: "assistant" } }] })}\n\n`,
        ": keep-alive\n\n",
        "data: {not json\n\n",
        delta("ok"),
        "data: [DONE]\n\n",
      ]),
    );
    expect(await collect(streamChat(messages))).toEqual(["ok"]);
  });

  it("sends a streaming request with the key, model and messages", async () => {
    fetchMock.mockResolvedValue(sse(["data: [DONE]\n\n"]));
    await collect(streamChat(messages));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer sk-test");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ stream: true, messages, model: "gpt-4o-mini" });
  });

  it("throws with the status when OpenAI returns an error", async () => {
    fetchMock.mockResolvedValue(new Response("rate limited", { status: 429 }));
    await expect(collect(streamChat(messages))).rejects.toThrow(/429.*rate limited/);
  });

  it("throws when the API key is missing", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    await expect(collect(streamChat(messages))).rejects.toThrow("OPENAI_API_KEY");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes the abort signal through", async () => {
    fetchMock.mockResolvedValue(sse(["data: [DONE]\n\n"]));
    const controller = new AbortController();
    await collect(streamChat(messages, controller.signal));
    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
  });
});

describe("embeddings", () => {
  const embeddingResponse = (inputs: number, offset = 0) =>
    new Response(
      JSON.stringify({
        // deliberately out of order: callers must get results back in input order
        data: Array.from({ length: inputs }, (_, i) => ({ index: i, embedding: [offset + i] })).reverse(),
      }),
    );

  it("embeds in batches and preserves input order", async () => {
    fetchMock.mockResolvedValueOnce(embeddingResponse(96)).mockResolvedValueOnce(embeddingResponse(4, 96));
    const out = await embedTexts(Array.from({ length: 100 }, (_, i) => `t${i}`));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).input).toHaveLength(96);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).input).toHaveLength(4);
    expect(out.map((v) => v[0])).toEqual(Array.from({ length: 100 }, (_, i) => i));
  });

  it("uses text-embedding-3-small by default", async () => {
    fetchMock.mockResolvedValue(embeddingResponse(1));
    await embedText("hello");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe("text-embedding-3-small");
  });

  it("throws on API errors and without a key", async () => {
    fetchMock.mockResolvedValue(new Response("bad key", { status: 401 }));
    await expect(embedText("x")).rejects.toThrow(/401/);

    vi.stubEnv("OPENAI_API_KEY", "");
    await expect(embedText("x")).rejects.toThrow("OPENAI_API_KEY");
  });

  it("formats pgvector literals", () => {
    expect(toVectorLiteral([0.1, -2, 3])).toBe("[0.1,-2,3]");
  });
});
