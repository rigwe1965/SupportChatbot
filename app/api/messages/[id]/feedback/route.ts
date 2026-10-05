import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { parseFeedback, setFeedback } from "@/lib/feedback";

/** Sets or clears (rating: null) the signed-in user's feedback on one of their assistant messages. */
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = parseFeedback(await req.json().catch(() => null));
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { rating, comment } = parsed.value;
  const ok = await setFeedback(params.id, session.user.id, rating, comment);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ data: { rating, comment } });
}
