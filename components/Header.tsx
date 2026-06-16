import Link from "next/link";
import { Zap, ArrowRight, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { checkUserServer } from "@/lib/checkUserServer";
import { PricingModal } from "@/components/PricingModal";
import type { Plan } from "@/types/plans";
import { PLANS } from "@/lib/constants";
import SignOutButton from "@/components/SignOutButton";

export default async function Header() {
  const user = await checkUserServer();

  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-16 border-b border-white/6 bg-white/7 backdrop-blur-md">
      <nav className="mx-auto flex h-full max-w-7xl items-center justify-between px-4 sm:px-6">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 select-none group">
          {/* Neon C icon */}
          <svg
            width="40"
            height="40"
            viewBox="0 0 40 40"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="shrink-0"
          >
            <defs>
              <linearGradient id="cGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#38bdf8" />
                <stop offset="50%" stopColor="#818cf8" />
                <stop offset="100%" stopColor="#c084fc" />
              </linearGradient>
              <filter id="glow">
                <feGaussianBlur stdDeviation="1.5" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <path
              d="M30 12.5A14 14 0 1 0 30 27.5"
              stroke="url(#cGrad)"
              strokeWidth="3.5"
              strokeLinecap="round"
              filter="url(#glow)"
            />
          </svg>
          {/* Wordmark */}
          <span
            className="text-xl font-semibold tracking-tight text-white"
            style={{
              background: "linear-gradient(90deg, #ffffff 60%, #a5b4fc 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            Crevo
          </span>
        </Link>

        {/* Right side */}
        <div className="flex items-center gap-5">
          {user ? (
            <>
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

              {/* User avatar */}
              <div className="flex items-center gap-3">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-blue-400 to-purple-500 text-[11px] font-semibold text-white select-none">
                  {user.name?.[0]?.toUpperCase() ?? "U"}
                </div>
                <SignOutButton />
              </div>
            </>
          ) : (
            <>
              <Link href="/sign-in">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-[13px] font-medium text-white/80 hover:text-white/90 hover:bg-transparent"
                >
                  Sign in
                </Button>
              </Link>

              <Link href="/sign-up">
                <Button
                  size="sm"
                  className="inline-flex h-8 items-center gap-1.5 rounded-full bg-white px-4 text-[13px] font-semibold text-black hover:bg-white/90 active:scale-95"
                >
                  Get Started
                  <ArrowRight className="h-3 w-3 opacity-60" />
                </Button>
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
