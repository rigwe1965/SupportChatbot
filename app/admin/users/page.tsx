import { requireAdminPage } from "@/lib/admin-page";
import { db } from "@/lib/db";

export default async function UsersPage() {
  await requireAdminPage("/admin/users");
  const users = await db.user.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { _count: { select: { conversations: true } } },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Users</h1>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[34rem] text-left text-sm">
          <thead className="border-b border-border text-muted">
            <tr>
              <th className="p-3 font-medium">User</th>
              <th className="p-3 font-medium">Role</th>
              <th className="p-3 font-medium">Conversations</th>
              <th className="p-3 font-medium">Joined</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-border last:border-0">
                <td className="p-3">
                  <div className="flex items-center gap-3">
                    {u.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={u.image} alt="" className="h-8 w-8 rounded-full" />
                    ) : (
                      <span className="h-8 w-8 rounded-full bg-foreground/10" />
                    )}
                    <div className="min-w-0">
                      <p className="truncate font-medium">{u.name ?? "—"}</p>
                      <p className="truncate text-xs text-muted">{u.email}</p>
                    </div>
                  </div>
                </td>
                <td className="p-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      u.role === "ADMIN" ? "bg-brand text-brand-foreground" : "bg-foreground/10 text-muted"
                    }`}
                  >
                    {u.role === "ADMIN" ? "Admin" : "Free"}
                  </span>
                </td>
                <td className="p-3">{u._count.conversations}</td>
                <td className="p-3 text-muted">{u.createdAt.toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
