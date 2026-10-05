import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { recordAudit } from "@/lib/audit";
import { requireAdmin } from "@/lib/guard";
import { db } from "@/lib/db";
import { shortTicketId } from "@/lib/ticket-format";

/** Marks a ticket resolved; the chatbot resumes answering in that conversation. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  try {
    const ticket = await db.ticket.update({
      where: { id: params.id },
      data: { status: "RESOLVED", resolvedAt: new Date() },
    });
    await recordAudit(
      auth,
      {
        action: "ticket.resolve",
        targetType: "ticket",
        targetId: ticket.id,
        summary: `Resolved ticket #${shortTicketId(ticket.id)}`,
        metadata: { reason: ticket.reason },
      },
      req,
    );
    return NextResponse.json({ data: ticket });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    throw err;
  }
}
