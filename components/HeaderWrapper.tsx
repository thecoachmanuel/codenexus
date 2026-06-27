"use client";

import { usePathname } from "next/navigation";

export function HeaderWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  
  if (pathname?.startsWith("/admin") || pathname?.startsWith("/preview")) {
    return null;
  }
  
  return <>{children}</>;
}
