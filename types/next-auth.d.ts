import type { DefaultSession } from "next-auth";

export type UserRole = "FREE" | "ADMIN";

declare module "next-auth" {
  interface Session {
    /** When this session's sign-in happened (ms since epoch); compared with User.sessionsValidFrom. */
    authAt?: number;
    user: { id: string; role: UserRole } & DefaultSession["user"];
  }
  interface User {
    role: UserRole;
    emailVerified?: Date | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: UserRole;
    authAt?: number;
  }
}
