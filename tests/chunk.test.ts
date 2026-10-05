import { describe, expect, it } from "vitest";
import { chunkText } from "@/lib/chunk";

const paragraph = (n: number) => `Sentence number ${n} explains how the feature works in some detail.`;

describe("chunkText", () => {
  it("returns nothing for empty or whitespace-only text", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("  \n\n  ")).toEqual([]);
  });

  it("keeps short text as a single trimmed chunk", () => {
    expect(chunkText("  Hello world  ")).toEqual(["Hello world"]);
  });

  it("normalises Windows line endings", () => {
    expect(chunkText("a\r\nb")).toEqual(["a\nb"]);
  });

  it("splits long text into chunks of at most ~1200 characters", () => {
    const text = Array.from({ length: 80 }, (_, i) => paragraph(i)).join(" ");
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(1200);
      expect(c.trim()).toBe(c);
      expect(c.length).toBeGreaterThan(0);
    }
  });

  it("does not lose content: every sentence appears in some chunk", () => {
    const sentences = Array.from({ length: 80 }, (_, i) => paragraph(i));
    const chunks = chunkText(sentences.join("\n\n"));
    const joined = chunks.join("\n");
    for (const s of sentences) expect(joined).toContain(s);
  });

  it("overlaps consecutive chunks so context isn't cut mid-thought", () => {
    const chunks = chunkText(Array.from({ length: 80 }, (_, i) => paragraph(i)).join(" "));
    const tailOfFirst = chunks[0].slice(-40);
    expect(chunks[1]).toContain(tailOfFirst.trim().split(" ").slice(-3).join(" "));
  });

  it("prefers paragraph boundaries when available", () => {
    const a = "A".repeat(700);
    const b = "B".repeat(700);
    const [first] = chunkText(`${a}\n\n${b}`);
    expect(first).toBe(a);
  });

  it("terminates and still splits text with no whitespace", () => {
    const chunks = chunkText("x".repeat(5000));
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.every((c) => c.length <= 1200)).toBe(true);
  });
});
