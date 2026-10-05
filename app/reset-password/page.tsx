import { AuthCard, Notice, TextLink } from "@/components/auth/AuthCard";
import ResetPasswordForm from "@/components/auth/ResetPasswordForm";
import { isTokenValid } from "@/lib/auth-tokens";

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({ searchParams }: { searchParams: { token?: string } }) {
  const token = searchParams.token ?? "";
  // Checking doesn't use the link up, so email scanners that open it don't break it.
  const valid = await isTokenValid(token, "RESET_PASSWORD");

  return (
    <AuthCard title="Choose a new password">
      {valid ? (
        <ResetPasswordForm token={token} />
      ) : (
        <>
          <Notice kind="error">This reset link is invalid or has expired.</Notice>
          <p className="text-center text-sm">
            <TextLink href="/forgot-password">Request a new link</TextLink>
          </p>
        </>
      )}
    </AuthCard>
  );
}
