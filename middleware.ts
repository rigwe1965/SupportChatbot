import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function middleware(req) {
    if (req.nextUrl.pathname.startsWith("/admin") && req.nextauth.token?.role !== "ADMIN") {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }
  },
  {
    callbacks: { authorized: ({ token }) => !!token },
    pages: { signIn: "/signin" },
  },
);

// Routes that require a signed-in user. /admin additionally requires the ADMIN role.
export const config = { matcher: ["/dashboard/:path*", "/admin/:path*", "/chat/:path*"] };
