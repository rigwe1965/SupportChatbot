import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/guard", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/feedback-review", async (original) => ({
  ...(await original<typeof import("@/lib/feedback-review")>()),
  listNegativeFeedback: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: {} }));

import { GET } from "@/app/api/admin/feedback/export/route";
import { toCsv } from "@/lib/csv";
import { feedbackToCsv, FEEDBACK_EXPORT_LIMIT } from "@/lib/feedback-export";
import { listNegativeFeedback, parseFeedbackStatus, type NegativeFeedbackItem } from "@/lib/feedback-review";
import { requireAdmin } from "@/lib/guard";

const BOM = "﻿";

describe("toCsv", () => {
  it("starts with a UTF-8 BOM and uses CRLF line endings, ending with a newline", () => {
    const csv = toCsv(["a", "b"], [["1", "2"]]);
    expect(csv).toBe(`${BOM}a,b\r\n1,2\r\n`);
  });

  it("quotes cells containing commas, quotes or line breaks, doubling inner quotes", () => {
    const csv = toCsv(["x"], [["a,b"], ['say "hi"'], ["line1\nline2"], ["cr\rhere"]]);
    expect(csv).toBe(`${BOM}x\r\n"a,b"\r\n"say ""hi"""\r\n"line1\nline2"\r\n"cr\rhere"\r\n`);
  });

  it("leaves plain cells unquoted and keeps unicode intact", () => {
    expect(toCsv(["x"], [["héllo 你好 🙂"]])).toBe(`${BOM}x\r\nhéllo 你好 🙂\r\n`);
  });

  it("writes null/undefined as empty cells, numbers and booleans as text, dates as ISO", () => {
    const csv = toCsv(["a", "b", "c", "d", "e"], [[null, undefined, 42, true, new Date("2026-01-02T03:04:05Z")]]);
    expect(csv).toBe(`${BOM}a,b,c,d,e\r\n,,42,true,2026-01-02T03:04:05.000Z\r\n`);
  });

  it.each(["=SUM(A1:A9)", "+1+1", "-2+3", "@cmd", "\tTabbed", "\rReturn"])(
    "neutralises spreadsheet formulas: %j",
    (text) => {
      const cellText = toCsv(["x"], [[text]]).split("\r\n")[1];
      expect(cellText.replace(/^"/, "").startsWith("'")).toBe(true);
    },
  );

  it("neutralises a formula even when the cell also needs quoting", () => {
    const line = toCsv(["x"], [['=HYPERLINK("http://evil.test","click")']]).split("\r\n")[1];
    expect(line).toBe(`"'=HYPERLINK(""http://evil.test"",""click"")"`);
  });

  it("does not alter harmless text that merely contains those characters", () => {
    expect(toCsv(["x"], [["a=b"], ["e-mail"], ["10-20"]]).split("\r\n").slice(1, 4)).toEqual(["a=b", "e-mail", "10-20"]);
  });

  it("produces just the header when there are no rows", () => {
    expect(toCsv(["a", "b"], [])).toBe(`${BOM}a,b\r\n`);
  });
});

const item = (over: Partial<NegativeFeedbackItem> = {}): NegativeFeedbackItem => ({
  id: "m1",
  conversationId: "c1",
  question: "How do refunds work?",
  answer: "Refunds take 5 days [1].",
  comment: "Wrong, it is 10 days",
  sources: [
    { title: "Refund policy", category: "Billing" },
    { title: "FAQ", category: "" },
  ],
  feedbackAt: new Date("2026-01-02T03:04:05Z"),
  reviewedAt: null,
  userName: "Ada",
  userEmail: "ada@example.com",
  ...over,
});

const parse = (csv: string) => csv.replace(BOM, "").trimEnd().split("\r\n");

describe("feedbackToCsv", () => {
  it("has a descriptive header", () => {
    expect(parse(feedbackToCsv([]))[0]).toBe(
      "Rated at (UTC),Status,Reviewed at (UTC),User name,User email,Question,Answer,Customer reason,Cited articles,Conversation ID,Message ID",
    );
  });

  it("writes one row per item with all the review details", () => {
    const [, row] = parse(feedbackToCsv([item()]));
    expect(row).toBe(
      '2026-01-02T03:04:05.000Z,To review,,Ada,ada@example.com,How do refunds work?,Refunds take 5 days [1].,"Wrong, it is 10 days",Refund policy (Billing) | FAQ,c1,m1',
    );
  });

  it("marks reviewed items with their review time", () => {
    const [, row] = parse(feedbackToCsv([item({ reviewedAt: new Date("2026-01-03T00:00:00Z") })]));
    expect(row).toContain(",Reviewed,2026-01-03T00:00:00.000Z,");
  });

  it("handles missing question, reason, user and sources", () => {
    const [, row] = parse(
      feedbackToCsv([item({ question: null, comment: null, userName: null, userEmail: null, sources: [] })]),
    );
    expect(row).toBe("2026-01-02T03:04:05.000Z,To review,,,,,Refunds take 5 days [1].,,,c1,m1");
  });

  it("defuses formulas typed by customers in any text field", () => {
    const evil = "=cmd|' /C calc'!A0";
    const csv = feedbackToCsv([item({ comment: evil, question: evil, userName: "+evil", answer: "@evil" })]);
    expect(csv).not.toMatch(/(^|,)=cmd/m);
    expect(csv).toContain("'=cmd");
    expect(csv).toContain("'+evil");
    expect(csv).toContain("'@evil");
  });

  it("keeps multi-line answers in a single quoted cell", () => {
    const csv = feedbackToCsv([item({ answer: "line one\nline two" })]);
    expect(csv).toContain('"line one\nline two"');
  });
});

describe("parseFeedbackStatus", () => {
  it.each([
    ["reviewed", "reviewed"],
    ["all", "all"],
    ["todo", "todo"],
    ["bogus", "todo"],
    ["", "todo"],
    [null, "todo"],
    [undefined, "todo"],
  ])("%j -> %s", (input, expected) => {
    expect(parseFeedbackStatus(input as string | null)).toBe(expected);
  });
});

describe("GET /api/admin/feedback/export", () => {
  const list = vi.mocked(listNegativeFeedback);
  const get = (qs = "") => GET(new Request(`http://localhost/api/admin/feedback/export${qs}`));

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue({ userId: "admin1", email: "admin@example.com" });
    list.mockResolvedValue([item()]);
  });

  it("is admin-only and doesn't query anything for others", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    });
    expect((await get()).status).toBe(403);
    expect(list).not.toHaveBeenCalled();
  });

  it("returns a CSV attachment with a dated filename", async () => {
    const res = await get("?status=all");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment; filename="feedback-all-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(res.headers.get("Cache-Control")).toBe("no-store");

    // Response.text() strips a BOM, so check the raw bytes that a download would contain.
    const bytes = new Uint8Array(await res.clone().arrayBuffer());
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(await res.text()).toContain("Refund policy (Billing)");
  });

  it("exports the same filter the page is showing", async () => {
    await get("?status=reviewed");
    expect(list).toHaveBeenCalledWith("reviewed", FEEDBACK_EXPORT_LIMIT);
  });

  it("defaults to the review queue and ignores unknown statuses", async () => {
    await get();
    await get("?status=drop-table");
    expect(list.mock.calls.map((c) => c[0])).toEqual(["todo", "todo"]);
  });

  it("is not capped at the page size of the on-screen list", () => {
    expect(FEEDBACK_EXPORT_LIMIT).toBeGreaterThan(100);
  });

  it("returns just the header when there is nothing to export", async () => {
    list.mockResolvedValue([]);
    const body = await (await get()).text();
    expect(parse(body)).toHaveLength(1);
  });
});
