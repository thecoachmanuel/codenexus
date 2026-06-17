"use client";

import { useEffect, useState } from "react";
import { Users, Folder, Crown, Zap, UserCheck, TrendingUp } from "lucide-react";

interface Stats {
  totalUsers: number;
  totalProjects: number;
  plans: { free: number; starter: number; pro: number };
  recentUsers: { name: string; email: string; plan: string; createdAt: string }[];
}

function StatCard({ icon: Icon, label, value, sub, color }: {
  icon: React.ElementType;
  label: string;
  value: number | string;
  sub?: string;
  color: string;
}) {
  return (
    <div className="rounded-xl bg-[#111] border border-white/10 p-6 flex items-start gap-4 hover:border-white/20 transition-colors">
      <div className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${color}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className="text-sm text-white/50">{label}</p>
        <p className="text-2xl font-bold text-white mt-0.5">{value}</p>
        {sub && <p className="text-xs text-white/30 mt-1">{sub}</p>}
      </div>
    </div>
  );
}

const PLAN_COLORS: Record<string, string> = {
  free: "bg-white/10 text-white/60",
  starter: "bg-blue-500/10 text-blue-400",
  pro: "bg-purple-500/10 text-purple-400",
};

export default function AdminOverviewPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/stats")
      .then((r) => r.json())
      .then((d) => setStats(d))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-28 rounded-xl bg-white/5 border border-white/10" />
          ))}
        </div>
        <div className="h-64 rounded-xl bg-white/5 border border-white/10" />
      </div>
    );
  }

  if (!stats) return <p className="text-red-400">Failed to load stats.</p>;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Overview</h1>
        <p className="text-white/40 text-sm mt-1">System-wide metrics and activity.</p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard icon={Users} label="Total Users" value={stats.totalUsers} color="bg-blue-500/10 text-blue-400" />
        <StatCard icon={Folder} label="Total Projects" value={stats.totalProjects} color="bg-emerald-500/10 text-emerald-400" />
        <StatCard icon={Crown} label="Pro Users" value={stats.plans.pro} sub="Active Pro subscriptions" color="bg-purple-500/10 text-purple-400" />
        <StatCard icon={Zap} label="Starter Users" value={stats.plans.starter} sub="Active Starter subscriptions" color="bg-amber-500/10 text-amber-400" />
      </div>

      {/* Plan Breakdown */}
      <div className="rounded-xl bg-[#111] border border-white/10 p-6">
        <h2 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-white/40" /> Plan Distribution
        </h2>
        <div className="space-y-3">
          {(["pro", "starter", "free"] as const).map((plan) => {
            const count = stats.plans[plan];
            const pct = stats.totalUsers > 0 ? Math.round((count / stats.totalUsers) * 100) : 0;
            return (
              <div key={plan}>
                <div className="flex justify-between mb-1.5">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${PLAN_COLORS[plan]}`}>{plan}</span>
                  <span className="text-xs text-white/40">{count} users ({pct}%)</span>
                </div>
                <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${plan === "pro" ? "bg-purple-500" : plan === "starter" ? "bg-blue-500" : "bg-white/20"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent Sign-ups */}
      <div className="rounded-xl bg-[#111] border border-white/10 p-6">
        <h2 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
          <UserCheck className="w-4 h-4 text-white/40" /> Recent Sign-ups
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-white/40 text-xs uppercase">
                <th className="text-left pb-3 font-medium">Name</th>
                <th className="text-left pb-3 font-medium">Email</th>
                <th className="text-left pb-3 font-medium">Plan</th>
                <th className="text-left pb-3 font-medium">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {stats.recentUsers.map((u, i) => (
                <tr key={i} className="text-white/70">
                  <td className="py-3 font-medium text-white">{u.name}</td>
                  <td className="py-3 text-white/50">{u.email}</td>
                  <td className="py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs capitalize ${PLAN_COLORS[u.plan]}`}>
                      {u.plan}
                    </span>
                  </td>
                  <td className="py-3 text-white/40 text-xs">{new Date(u.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
