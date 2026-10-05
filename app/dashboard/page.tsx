import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

export default async function DashboardPage() {
  // Middleware already guards this route; this also narrows the type.
  const session = await getSession();
  if (!session) redirect("/signin?callbackUrl=/dashboard");

  return (
    <div className="space-y-2">
      <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
      <p className="text-muted">
        Signed in as {session.user.email} · plan: {session.user.role === "ADMIN" ? "Admin" : "Free"}
      </p>
    </div>
  );
}
