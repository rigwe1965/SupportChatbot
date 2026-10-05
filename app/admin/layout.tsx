import AdminNav from "@/components/admin/AdminNav";
import { requireAdminPage } from "@/lib/admin-page";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdminPage("/admin");
  const openTickets = await db.ticket.count({ where: { status: "OPEN" } });

  return (
    <div className="space-y-8">
      <AdminNav openTickets={openTickets} />
      {children}
    </div>
  );
}
