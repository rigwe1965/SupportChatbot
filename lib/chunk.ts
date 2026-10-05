const MAX_CHARS = 1200;
const OVERLAP = 200;

/**
 * Splits text into chunks of roughly MAX_CHARS, preferring paragraph, then
 * sentence, then word boundaries, with a small overlap between chunks.
 */
export function chunkText(text: string): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (clean.length <= MAX_CHARS) return clean ? [clean] : [];

  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + MAX_CHARS, clean.length);
    if (end < clean.length) {
      const window = clean.slice(start, end);
      const floor = MAX_CHARS * 0.5;
      const cut = Math.max(
        window.lastIndexOf("\n\n"),
        window.lastIndexOf(". "),
        window.lastIndexOf("\n"),
        window.lastIndexOf(" "),
      );
      if (cut > floor) end = start + cut + 1;
    }
    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    start = Math.max(end - OVERLAP, start + 1);
  }
  return chunks;
}
