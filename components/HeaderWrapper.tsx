"use client";

import { usePathname } from "next/navigation";

export function HeaderWrapper({ children, host }: { children: React.ReactNode; host?: string | null }) {
  const pathname = usePathname();
  
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "crevoai.website";
  const isSubdomain = host && host.includes(`.${rootDomain}`) && host !== rootDomain && host !== `www.${rootDomain}`;
  const isLocalSubdomain = host && host.includes(".localhost:3000") && host !== "localhost:3000" && !host.startsWith("www.localhost:3000");

  if (pathname?.startsWith("/admin") || pathname?.startsWith("/preview") || isSubdomain || isLocalSubdomain) {
    return null;
  }
  
  return <>{children}</>;
}
