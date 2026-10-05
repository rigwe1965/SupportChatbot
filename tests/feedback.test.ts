import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: { message: { findFirst: vi.fn(), update: vi.fn() } },
}));

import { PUT } from "@/app/api/messages/[id]/feedback/route";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { isRateable, parseFeedback, setFeedback } from "@/lib/feedback";

const session = vi.mocked(getSession);
const findMessage = vi.mocked(db.message.findFirst);
const updateMessage = vi.mocked(db.message.update);

beforeEach(() => {
  vi.resetAllMocks();
  session.mockResolvedValue({ user: { id: "u1" } } as never);
  findMessage.mockResolvedValue({ id: "m1" } as never);
  updateMessage.mockResolvedValue({} as never);
});

describe("isRateable", () => {
  it("is true for answers that cite sources", () => {
    expect(isRateable({ sources: [{ n: 1 }], lowConfidence: false })).toBe(true);
  });
  it("is true for the 'couldn't find it' reply (low confidence, no sources)", () => {
    expect(isRateable({ sources: [], lowConfidence: true })).toBe(true);
  });
  it("is false for hand-off and paused notices", () => {
    expect(isRateable({ sources: [], lowConfidence: false })).toBe(false);
    expect(isRateable({ sources: null, lowConfidence: false })).toBe(false);
  });
});

describe("parseFeedback", () => {
  it("accepts UP, DOWN and null", () => {
    expect(parseFeedback({ rating: "UP" })).toEqual({ value: { rating: "UP", comment: null } });
    expect(parseFeedback({ rating: "DOWN" })).toEqual({ value: { rating: "DOWN", comment: null } });
    expect(parseFeedback({ rating: null })).toEqual({ value: { rating: null, comment: null } });
  });

  it.each([{}, { rating: "up" }, { rating: 1 }, { rating: "MAYBE" }, null, "UP"])("rejects %j", (body) => {
    expect("error" in parseFeedback(body)).toBe(true);
  });

  it("keeps a trimmed comment only for a thumbs down", () => {
    expect(parseFeedback({ rating: "DOWN", comment: "  wrong price  " })).toEqual({
      value: { rating: "DOWN", comment: "wrong price" },
    });
    expect(parseFeedback({ rating: "UP", comment: "great" })).toEqual({ value: { rating: "UP", comment: null } });
    expect(parseFeedback({ rating: null, comment: "x" })).toEqual({ value: { rating: null, comment: null } });
  });

  it("treats a blank comment as none", () => {
    expect(parseFeedback({ rating: "DOWN", comment: "   " })).toEqual({ value: { rating: "DOWN", comment: null } });
  });

  it("rejects non-string and oversized comments", () => {
    expect("error" in parseFeedback({ rating: "DOWN", comment: 5 })).toBe(true);
    expect("error" in parseFeedback({ rating: "DOWN", comment: "x".repeat(501) })).toBe(true);
    expect("error" in parseFeedback({ rating: "DOWN", comment: "x".repeat(500) })).toBe(false);
  });
});

describe("setFeedback", () => {
  it("only touches assistant messages in the user's own conversations", async () => {
    await setFeedback("m1", "u1", "UP", null);
    expect(findMessage).toHaveBeenCalledWith({
      where: { id: "m1", role: "assistant", conversation: { userId: "u1" } },
      select: { id: true },
    });
  });

  it("returns false and writes nothing for someone else's message", async () => {
    findMessage.mockResolvedValue(null);
    expect(await setFeedback("m1", "intruder", "UP", null)).toBe(false);
    expect(updateMessage).not.toHaveBeenCalled();
  });

  it("stores the rating, reason and timestamp", async () => {
    expect(await setFeedback("m1", "u1", "DOWN", "wrong")).toBe(true);
    expect(updateMessage).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: { feedback: "DOWN", feedbackComment: "wrong", feedbackAt: expect.any(Date) },
    });
  });

  it("clears everything when the rating is removed", async () => {
    await setFeedback("m1", "u1", null, "stale comment");
    expect(updateMessage).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: { feedback: null, feedbackComment: null, feedbackAt: null },
    });
  });
});

describe("PUT /api/messages/[id]/feedback", () => {
  const put = (body: unknown, id = "m1") =>
    PUT(new Request("http://localhost/x", { method: "PUT", body: JSON.stringify(body) }), { params: { id } });

  it("rejects signed-out users", async () => {
    session.mockResolvedValue(null);
    expect((await put({ rating: "UP" })).status).toBe(401);
    expect(updateMessage).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid body", async () => {
    expect((await put({ rating: "nope" })).status).toBe(400);
    expect(updateMessage).not.toHaveBeenCalled();
  });

  it("returns 404 for a message that isn't theirs", async () => {
    findMessage.mockResolvedValue(null);
    expect((await put({ rating: "UP" })).status).toBe(404);
  });

  it("saves a thumbs down with a reason", async () => {
    const res = await put({ rating: "DOWN", comment: "did not answer my question" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { rating: "DOWN", comment: "did not answer my question" } });
    expect(updateMessage).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ feedback: "DOWN" }) }),
    );
  });

  it("clears feedback with a null rating", async () => {
    const res = await put({ rating: null });
    expect(res.status).toBe(200);
    expect(updateMessage).toHaveBeenCalledWith(
      expect.objectContaining({ data: { feedback: null, feedbackComment: null, feedbackAt: null } }),
    );
  });

  it("scopes the lookup to the signed-in user", async () => {
    session.mockResolvedValue({ user: { id: "u2" } } as never);
    await put({ rating: "UP" });
    expect(findMessage).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ conversation: { userId: "u2" } }) }),
    );
  });
});
