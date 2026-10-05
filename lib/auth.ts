import type { NextAuthOptions } from "next-auth";
import { getServerSession } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import GitHubProvider from "next-auth/providers/github";
import CredentialsProvider from "next-auth/providers/credentials";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { recordAudit } from "@/lib/audit";
import { authorizeCredentials } from "@/lib/credentials";
import { db } from "@/lib/db";
import { ipFromHeaders } from "@/lib/ip";

const adminEmails = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

/**
 * Whether this sign-in should get the admin role. Google/GitHub vouch for the email themselves; for
 * password accounts the address must have been confirmed, otherwise anyone could sign up as an
 * ADMIN_EMAILS address and be promoted.
 */
function isAdminSignIn(user: { email?: string | null; emailVerified?: Date | null }, provider?: string) {
  if (!user.email || !adminEmails.includes(user.email.toLowerCase())) return false;
  return provider !== "credentials" || !!user.emailVerified;
}

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(db),
  // JWT sessions so middleware can read the role without a DB hit;
  // users and accounts are still persisted by the adapter.
  session: { strategy: "jwt" },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    }),
    GitHubProvider({
      clientId: process.env.GITHUB_ID ?? "",
      clientSecret: process.env.GITHUB_SECRET ?? "",
    }),
    CredentialsProvider({
      name: "Email and password",
      credentials: { email: { type: "email" }, password: { type: "password" } },
      authorize: (credentials, req) => authorizeCredentials(credentials, ipFromHeaders(req?.headers)),
    }),
  ],
  pages: { signIn: "/signin" },
  callbacks: {
    async jwt({ token, user, account }) {
      if (user) {
        token.id = user.id;
        // The adapter returns the freshly created user as FREE; apply the admin list here
        // so the very first sign-in already carries the right role.
        token.role = isAdminSignIn(user, account?.provider) ? "ADMIN" : user.role;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.id;
      session.user.role = token.role;
      return session;
    },
  },
  events: {
    // Persist the promotion for configured admin emails.
    async signIn({ user, account }) {
      if (isAdminSignIn(user, account?.provider) && user.role !== "ADMIN") {
        await db.user.update({ where: { id: user.id }, data: { role: "ADMIN" } });
        await recordAudit(
          { userId: user.id, email: user.email },
          {
            action: "user.promoted_admin",
            targetType: "user",
            targetId: user.id,
            summary: `${user.email} was promoted to admin (listed in ADMIN_EMAILS)`,
          },
        );
      }
    },
  },
};

/**
 * The current session, or null. Sessions are JWTs that outlive the account (e.g. on other devices
 * after "delete my account"), so this also confirms the user still exists.
 */
export async function getSession() {
  const session = await getServerSession(authOptions);
  if (!session) return null;
  const exists = await db.user.findUnique({ where: { id: session.user.id }, select: { id: true } });
  return exists ? session : null;
}
