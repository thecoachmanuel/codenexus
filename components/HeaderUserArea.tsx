"use client";

import Link from "next/link";
import { Zap } from "lucide-react";
import { useAuthContext } from "@/components/AuthProvider";
import { PricingModal } from "@/components/PricingModal";
import { ProfileModal } from "@/components/ProfileModal";
import { cn } from "@/lib/utils";

export function HeaderUserArea() {
  const { user, isLoading } = useAuthContext();

  if (isLoading) {
    // Skeleton placeholder
    return (
      <div className="flex items-center gap-4">
        <div className="h-4 w-20 animate-pulse rounded-full bg-white/10" />
        <div className="h-7 w-7 animate-pulse rounded-full bg-white/10" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex items-center gap-4">
      <Link
        href="/projects"
        className="text-[13px] font-medium text-white/70 transition-colors hover:text-white/80"
      >
        Projects
      </Link>

      <PricingModal>
        <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/25 bg-white/5 px-3 text-sm text-white cursor-pointer hover:border-white/20 hover:bg-white/10 transition-colors">
          <Zap className="h-3 w-3 fill-white/70" />
          {user.credits} credits
          {user.plan !== "free" && (
            <span className="ml-1 rounded-full bg-blue-500/20 px-1.5 py-0.5 text-[10px] text-blue-400 capitalize">
              {user.plan}
            </span>
          )}
        </span>
      </PricingModal>

      {/* Avatar → opens ProfileModal */}
      <ProfileModal>
        <button
          title="Account settings"
          className={cn(
            "group relative flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-blue-400 to-purple-500",
            "text-[12px] font-bold text-white select-none",
            "ring-2 ring-transparent hover:ring-white/30 transition-all duration-150 cursor-pointer"
          )}
        >
          {user.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.imageUrl}
              alt={user.name}
              className="h-8 w-8 rounded-full object-cover"
            />
          ) : (
            user.name?.[0]?.toUpperCase() ?? "U"
          )}
          {/* Online indicator dot */}
          <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#0a0a0a] bg-green-400" />
        </button>
      </ProfileModal>
    </div>
  );
}
