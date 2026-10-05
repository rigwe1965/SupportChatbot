import AdminNav from "@/components/admin/AdminNav";
import { requireAdminPage } from "@/lib/admin-page";
import { db } from "@/lib/db";
import { countUnreviewedNegative } from "@/lib/feedback-review";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdminPage("/admin");
  const [openTickets, unreviewedFeedback] = await Promise.all([
    db.ticket.count({ where: { status: "OPEN" } }),
    countUnreviewedNegative(),
  ]);

  return (
    <div className="space-y-8">
      <AdminNav openTickets={openTickets} unreviewedFeedback={unreviewedFeedback} />
      {children}
    </div>
  );
}
