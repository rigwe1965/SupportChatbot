import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

/** For admin server pages: redirects non-admins, returns the session otherwise. */
export async function requireAdminPage(callbackUrl: string) {
  const session = await getSession();
  if (!session) redirect(`/signin?callbackUrl=${callbackUrl}`);
  // Re-check against the DB so a demoted admin loses access before their JWT expires.
  const me = await db.user.findUnique({ where: { id: session.user.id }, select: { role: true } });
  if (me?.role !== "ADMIN") redirect("/dashboard");
  return session;
}
