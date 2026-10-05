const MODEL = process.env.CHAT_MODEL ?? "gpt-4o-mini";

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Streams completion text deltas from OpenAI's chat completions API. */
export async function* streamChat(
  messages: LlmMessage[],
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: MODEL, messages, stream: true, temperature: 0.2 }),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`OpenAI chat failed (${res.status}): ${await res.text()}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        const delta = JSON.parse(data).choices?.[0]?.delta?.content;
        if (delta) yield delta as string;
      } catch {
        // ignore malformed keep-alive lines
      }
    }
  }
}
