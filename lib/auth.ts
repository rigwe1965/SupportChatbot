import type { NextAuthOptions } from "next-auth";
import { getServerSession } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import GitHubProvider from "next-auth/providers/github";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";

const adminEmails = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

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
  ],
  pages: { signIn: "/signin" },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        // The adapter returns the freshly created user as FREE; apply the admin list here
        // so the very first sign-in already carries the right role.
        token.role =
          user.email && adminEmails.includes(user.email.toLowerCase()) ? "ADMIN" : user.role;
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
    async signIn({ user }) {
      if (user.email && adminEmails.includes(user.email.toLowerCase()) && user.role !== "ADMIN") {
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

export const getSession = () => getServerSession(authOptions);
