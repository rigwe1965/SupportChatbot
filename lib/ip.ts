type HeaderBag = Headers | Record<string, string | string[] | undefined>;

function read(headers: HeaderBag, name: string): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

/** Best-effort client IP from Fetch `Headers` or Node-style header objects. */
export function ipFromHeaders(headers: HeaderBag | undefined): string | null {
  if (!headers) return null;
  const forwarded = read(headers, "x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || read(headers, "x-real-ip")?.trim() || null;
}
