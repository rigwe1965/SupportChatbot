import { NextResponse } from "next/server";
import { setReviewed } from "@/lib/feedback-review";
import { requireAdmin } from "@/lib/guard";

/** Marks a thumbs-down as reviewed (`{ reviewed: true }`) or reopens it (`{ reviewed: false }`). */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const body = await req.json().catch(() => null);
  if (typeof body?.reviewed !== "boolean") {
    return NextResponse.json({ error: "`reviewed` must be true or false" }, { status: 400 });
  }

  if (!(await setReviewed(params.id, body.reviewed))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ data: { id: params.id, reviewed: body.reviewed } });
}
