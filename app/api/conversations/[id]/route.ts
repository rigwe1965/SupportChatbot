import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getConversationMessages } from "@/lib/conversations";
import { db } from "@/lib/db";

type Ctx = { params: { id: string } };

export async function GET(_req: Request, { params }: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const messages = await getConversationMessages(params.id, session.user.id);
  if (!messages) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ data: messages });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { count } = await db.conversation.deleteMany({
    where: { id: params.id, userId: session.user.id },
  });
  if (count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ data: { id: params.id } });
}
