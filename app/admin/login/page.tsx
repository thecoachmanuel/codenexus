"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Lock, AlertCircle, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Login failed");
      }

      router.push("/admin");
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-[#111] rounded-2xl border border-white/10 p-8 shadow-2xl">
        <div className="flex flex-col items-center mb-8">
          <div className="h-12 w-12 bg-blue-500/10 rounded-full flex items-center justify-center mb-4 border border-blue-500/20">
            <Lock className="w-6 h-6 text-blue-400" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Admin Portal</h1>
          <p className="text-white/40 text-sm mt-2 text-center">
            Sign in to access the Crevo admin dashboard.
          </p>
        </div>

        {error && (
          <div className="mb-6 flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-white/70 mb-1.5">
              Email Address
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-black/50 border border-white/10 rounded-lg px-4 py-2.5 text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              placeholder="admin@crevo.com"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-white/70 mb-1.5">
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-black/50 border border-white/10 rounded-lg px-4 py-2.5 text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              placeholder="••••••••"
            />
          </div>

          <Button
            type="submit"
            disabled={isLoading}
            className={cn(
              "w-full h-10 mt-2 rounded-lg font-semibold transition-all",
              "bg-white text-black hover:bg-white/90"
            )}
          >
            {isLoading ? (
              "Signing in..."
            ) : (
              <span className="flex items-center gap-2">
                Secure Login <ArrowRight className="w-4 h-4" />
              </span>
            )}
          </Button>
        </form>
      </div>
    </main>
  );
}
