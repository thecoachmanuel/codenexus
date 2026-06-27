import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!api|_next/static|_next/image|favicon.ico).*)",
  ],
};

export function middleware(req: NextRequest) {
  const url = req.nextUrl;
  
  const hostHeader = req.headers.get("host") || "";
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "crevoai.website";
  
  // Check if we are on a subdomain of the root domain
  if (
    hostHeader.includes(`.${rootDomain}`) &&
    hostHeader !== rootDomain &&
    hostHeader !== `www.${rootDomain}`
  ) {
    const subdomain = hostHeader.replace(`.${rootDomain}`, "");
    return NextResponse.rewrite(new URL(`/preview/${subdomain}${url.pathname}`, req.url));
  }

  // Local development subdomain testing (e.g. app.localhost:3000)
  if (hostHeader.includes(".localhost:3000")) {
    const subdomain = hostHeader.split(".localhost:3000")[0];
    if (subdomain !== "www") {
      return NextResponse.rewrite(new URL(`/preview/${subdomain}${url.pathname}`, req.url));
    }
  }

  return NextResponse.next();
}
