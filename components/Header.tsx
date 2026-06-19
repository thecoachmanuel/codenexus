import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { checkUserServer } from "@/lib/checkUserServer";
import { HeaderUserArea } from "@/components/HeaderUserArea";

export default async function Header() {
  const user = await checkUserServer();

  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-16 border-b border-white/6 bg-white/7 backdrop-blur-md">
      <nav className="mx-auto flex h-full max-w-7xl items-center justify-between px-4 sm:px-6">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-1 select-none">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo-neon.png"
            alt="Crevo icon"
            className="h-10 w-auto rounded-lg"
            style={{ mixBlendMode: "screen" }}
          />
          <span
            className="hidden sm:inline text-xl font-semibold tracking-tight -ml-1"
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
            // Client component handles avatar + credits + profile modal
            <HeaderUserArea />
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
