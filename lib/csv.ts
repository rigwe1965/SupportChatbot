export type CsvCell = string | number | boolean | Date | null | undefined;

/**
 * Spreadsheet apps run cells that start with = + - @ (or a tab/CR) as formulas. Anything a customer
 * typed ends up in these files, so prefix risky text with an apostrophe to keep it inert.
 */
function neutralizeFormula(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function cell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  const text =
    value instanceof Date ? value.toISOString() : typeof value === "string" ? neutralizeFormula(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * RFC 4180 CSV: CRLF line endings, quotes doubled, a leading UTF-8 BOM so Excel reads
 * non-ASCII text correctly.
 */
export function toCsv(header: string[], rows: CsvCell[][]): string {
  const lines = [header, ...rows].map((r) => r.map(cell).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}
