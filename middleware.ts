import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const url = req.nextUrl;

  // Get hostname of request (e.g. demo.codenexus.com, demo.localhost:3000)
  const hostname = req.headers.get("host") || "";

  // Determine the subdomain
  let subdomain: string | null = null;
  
  // Local development
  if (hostname.includes("localhost:3000")) {
    if (hostname !== "localhost:3000") {
      subdomain = hostname.replace(".localhost:3000", "");
    }
  } 
  // Production (e.g. codenexus.com, or Vercel preview URLs)
  else {
    const cleanHost = hostname.split(":")[0];
    // Replace this with your actual production domain when you have one.
    // Assuming codenexus.com or any generic base domain structure.
    const parts = cleanHost.split(".");
    
    // If it's a standard subdomain like `app-xyz.domain.com` (3 parts)
    // For simple handling, if it's not the root domain or www, assume it's a dynamic preview subdomain.
    // NOTE: If you deploy to Vercel (e.g. your-app.vercel.app), Vercel's preview URLs have 3 parts.
    // To be safe, we'll look for our specific generated pattern: "app-xxxxx"
    if (parts.length >= 3 && parts[0].startsWith("app-")) {
      subdomain = parts[0];
    }
  }

  // If a valid subdomain was found, rewrite to the preview route
  if (subdomain && subdomain !== "www") {
    return NextResponse.rewrite(new URL(`/preview/${subdomain}${url.pathname}`, req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - images, fonts, etc.
     */
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
