import { AuthCard, Notice, TextLink } from "@/components/auth/AuthCard";
import VerifyEmailButton from "@/components/auth/VerifyEmailButton";
import { isTokenValid } from "@/lib/auth-tokens";

export const dynamic = "force-dynamic";

export default async function VerifyEmailPage({ searchParams }: { searchParams: { token?: string } }) {
  const token = searchParams.token ?? "";
  // Confirming needs a click (a POST) rather than happening on page load, so link scanners can't use it up.
  const valid = await isTokenValid(token, "VERIFY_EMAIL");

  return (
    <AuthCard title="Confirm your email">
      {valid ? (
        <VerifyEmailButton token={token} />
      ) : (
        <>
          <Notice kind="error">This confirmation link is invalid or has expired.</Notice>
          <p className="text-center text-sm">
            <TextLink href="/register">Sign up again</TextLink> to get a new link.
          </p>
        </>
      )}
    </AuthCard>
  );
}
