import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookieHeader } from "@/lib/auth";

// Routes that require authentication
const PROTECTED_PATTERNS = [
  /^\/workspace(\/.*)?$/,
  /^\/projects(\/.*)?$/,
];

// Routes that are always public
const PUBLIC_PATTERNS = [
  /^\/$/,
  /^\/sign-in(\/.*)?$/,
  /^\/sign-up(\/.*)?$/,
  /^\/api\/auth\/.*/,
  /^\/api\/billing\/webhook$/,
  /^\/_next\/.*/,
  /^\/favicon/,
  /^\/logo/,
  /^\/public\/.*/,
];

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hostname = request.headers.get("host") || "";

  // ─── Subdomain Routing ────────────────────────────────────────────────────────
  let subdomain: string | null = null;
  if (hostname.includes("localhost:3000")) {
    if (hostname !== "localhost:3000") {
      subdomain = hostname.replace(".localhost:3000", "");
    }
  } else {
    const cleanHost = hostname.split(":")[0];
    const parts = cleanHost.split(".");
    if (parts.length >= 3 && parts[0].startsWith("app-")) {
      subdomain = parts[0];
    }
  }

  if (subdomain && subdomain !== "www" && !pathname.startsWith('/api')) {
    return NextResponse.rewrite(new URL(`/preview/${subdomain}${pathname}`, request.url));
  }
  // ──────────────────────────────────────────────────────────────────────────────

  // Allow public routes
  if (PUBLIC_PATTERNS.some((p) => p.test(pathname))) {
    return NextResponse.next();
  }

  // Check if route needs protection
  const needsAuth = PROTECTED_PATTERNS.some((p) => p.test(pathname));
  if (!needsAuth) return NextResponse.next();

  // Verify JWT from cookie
  const cookieHeader = request.headers.get("cookie");
  const session = getSessionFromCookieHeader(cookieHeader);

  if (!session) {
    const signInUrl = new URL("/sign-in", request.url);
    signInUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
