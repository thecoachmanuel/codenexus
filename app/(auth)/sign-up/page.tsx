"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, Zap, ArrowRight, Loader2, Check } from "lucide-react";
import { useAuthContext } from "@/components/AuthProvider";

export default function SignUpPage() {
  const router = useRouter();
  const { refreshUser } = useAuthContext();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const passwordStrength = {
    length: password.length >= 8,
    hasNumber: /\d/.test(password),
    hasUpper: /[A-Z]/.test(password),
  };
  const isPasswordStrong = Object.values(passwordStrength).every(Boolean);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!isPasswordStrong) {
      setError("Please meet all password requirements");
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.message ?? "Something went wrong");
        return;
      }

      await refreshUser();
      router.push("/");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0a0a0a] px-4">
      <div className="w-full max-w-sm">
        {/* Logo mark */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white">
            <Zap className="h-5 w-5 fill-black text-black" />
          </div>
          <div className="text-center">
            <h1 className="text-lg font-semibold text-white">Create your account</h1>
            <p className="mt-1 text-base text-white/70">
              Start building for free · 10 generations included
            </p>
          </div>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-white/20 bg-white/3 p-6 backdrop-blur-sm">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-base text-red-400">
                {error}
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-white/80" htmlFor="name">
                Full name
              </label>
              <input
                id="name"
                type="text"
                autoComplete="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-xl border border-white/20 bg-white/4 px-4 py-3 text-base text-white placeholder:text-white/20 focus:border-white/20 focus:outline-none focus:ring-1 focus:ring-white/10 transition-colors"
                placeholder="Alex Johnson"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-white/80" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-white/20 bg-white/4 px-4 py-3 text-base text-white placeholder:text-white/20 focus:border-white/20 focus:outline-none focus:ring-1 focus:ring-white/10 transition-colors"
                placeholder="you@example.com"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-white/80" htmlFor="password">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-white/20 bg-white/4 px-4 py-3 pr-11 text-base text-white placeholder:text-white/20 focus:border-white/20 focus:outline-none focus:ring-1 focus:ring-white/10 transition-colors"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/25 hover:text-white/60 transition-colors"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>

              {/* Password strength indicators */}
              {password.length > 0 && (
                <div className="mt-2 space-y-1">
                  {[
                    { ok: passwordStrength.length, label: "At least 8 characters" },
                    { ok: passwordStrength.hasNumber, label: "Contains a number" },
                    { ok: passwordStrength.hasUpper, label: "Contains an uppercase letter" },
                  ].map(({ ok, label }) => (
                    <div key={label} className="flex items-center gap-2">
                      <div
                        className={`flex h-3.5 w-3.5 items-center justify-center rounded-full transition-colors ${
                          ok ? "bg-emerald-500/20" : "bg-white/8"
                        }`}
                      >
                        <Check
                          className={`h-2 w-2 transition-colors ${
                            ok ? "text-emerald-400" : "text-white/40"
                          }`}
                        />
                      </div>
                      <span
                        className={`text-[11px] transition-colors ${
                          ok ? "text-emerald-400/80" : "text-white/60"
                        }`}
                      >
                        {label}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-white py-3 text-base font-semibold text-black transition-all hover:bg-white/90 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  Create account
                  <ArrowRight className="h-3.5 w-3.5" />
                </>
              )}
            </button>
          </form>
        </div>

        <p className="mt-4 text-center text-base text-white/60">
          Already have an account?{" "}
          <Link href="/sign-in" className="text-white/90 underline-offset-2 hover:text-white hover:underline transition-colors">
            Sign in
          </Link>
        </p>

        <p className="mt-3 text-center text-sm text-white/40">
          No credit card required
        </p>
      </div>
    </div>
  );
}
