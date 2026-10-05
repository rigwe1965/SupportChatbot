import Link from "next/link";
import { requireAdminPage } from "@/lib/admin-page";
import { db } from "@/lib/db";

export default async function AdminPage() {
  await requireAdminPage("/admin");
  const users = await db.user.findMany({ orderBy: { createdAt: "desc" } });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-tight">Admin</h1>
        <div className="flex gap-4 text-sm">
          <Link href="/admin/tickets" className="text-brand hover:underline">
            Tickets
          </Link>
          <Link href="/admin/articles" className="text-brand hover:underline">
            Knowledge base →
          </Link>
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border text-muted">
            <tr>
              <th className="p-3 font-medium">Name</th>
              <th className="p-3 font-medium">Email</th>
              <th className="p-3 font-medium">Role</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-border last:border-0">
                <td className="p-3">{u.name ?? "—"}</td>
                <td className="p-3">{u.email}</td>
                <td className="p-3">{u.role}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
