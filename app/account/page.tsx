import { redirect } from "next/navigation";
import DeleteAccountForm from "@/components/auth/DeleteAccountForm";
import DownloadDataForm from "@/components/auth/DownloadDataForm";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

export const metadata = { title: "Account" };

export default async function AccountPage() {
  const session = await getSession();
  if (!session) redirect("/signin?callbackUrl=/account");

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { email: true, passwordHash: true },
  });
  if (!user) redirect("/signin");

  return (
    <div className="mx-auto max-w-xl space-y-8">
      <div className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight">Account</h1>
        <p className="text-muted">Signed in as {user.email ?? session.user.name}</p>
      </div>

      <section className="space-y-4 rounded-xl border border-border p-6">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Download my data</h2>
          <p className="text-sm text-muted">
            A JSON file with your profile, all of your conversations and messages (including any feedback you gave),
            and your support tickets. Passwords and sign-in tokens are never included.
          </p>
        </div>
        <DownloadDataForm needsPassword={!!user.passwordHash} />
      </section>

      <section className="space-y-4 rounded-xl border border-red-500/40 p-6">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Delete my account</h2>
          <p className="text-sm text-muted">
            This permanently deletes your account and all of your chat conversations. Support tickets you opened are
            kept for our records, but your name, email and the conversation text are removed from them. This can&apos;t
            be undone.
          </p>
        </div>
        <DeleteAccountForm needsPassword={!!user.passwordHash} />
      </section>
    </div>
  );
}
