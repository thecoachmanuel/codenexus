"use client";

import { useState, useEffect } from "react";
import { format } from "date-fns";
import { Loader2, RefreshCw, CheckCircle2, XCircle, TrendingUp, DollarSign, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

interface Transaction {
  _id: string;
  userId: { email: string; name?: string } | null;
  amount: number;
  currency: string;
  reference: string;
  status: string;
  planKey?: string;
  createdAt: string;
}

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [analytics, setAnalytics] = useState<any>(null);
  const [loadingStats, setLoadingStats] = useState(true);

  const fetchAnalytics = async () => {
    setLoadingStats(true);
    try {
      const token = localStorage.getItem("adminToken");
      const res = await fetch("/api/admin/analytics", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setAnalytics(await res.json());
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingStats(false);
    }
  };

  const fetchTransactions = async (pageNum = 1) => {
    setLoading(true);
    try {
      const token = localStorage.getItem("adminToken");
      const res = await fetch(`/api/admin/transactions?page=${pageNum}&limit=20`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) throw new Error("Failed to fetch transactions");
      
      const data = await res.json();
      setTransactions(data.transactions);
      setTotalPages(data.pagination.totalPages || 1);
      setPage(pageNum);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTransactions();
    fetchAnalytics();
  }, []);

  const formatCurrency = (amountInKobo: number) => {
    return (amountInKobo / 100).toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Dashboard & Transactions</h1>
          <p className="text-sm text-white/50">Track revenue, user growth, and payment history.</p>
        </div>
        <button
          onClick={() => { fetchTransactions(page); fetchAnalytics(); }}
          disabled={loading || loadingStats}
          className="flex items-center gap-2 rounded-md bg-white/5 px-4 py-2 text-sm font-medium text-white hover:bg-white/10 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={cn("h-4 w-4", (loading || loadingStats) && "animate-spin")} />
          Refresh
        </button>
      </div>

      {/* Analytics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-xl border border-white/10 bg-[#111] p-5 flex flex-col justify-between">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-xs font-medium text-white/50 uppercase tracking-wider mb-1">Monthly Recurring Revenue (30d)</p>
              <h3 className="text-2xl font-bold text-white">
                {loadingStats ? <Loader2 className="w-5 h-5 animate-spin text-white/30" /> : formatCurrency(analytics?.mrr || 0)}
              </h3>
            </div>
            <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-400">
              <TrendingUp className="w-5 h-5" />
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-[#111] p-5 flex flex-col justify-between">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-xs font-medium text-white/50 uppercase tracking-wider mb-1">Total Revenue (All Time)</p>
              <h3 className="text-2xl font-bold text-white">
                {loadingStats ? <Loader2 className="w-5 h-5 animate-spin text-white/30" /> : formatCurrency(analytics?.totalRevenue || 0)}
              </h3>
            </div>
            <div className="p-2 bg-blue-500/10 rounded-lg text-blue-400">
              <DollarSign className="w-5 h-5" />
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-[#111] p-5 flex flex-col justify-between">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-xs font-medium text-white/50 uppercase tracking-wider mb-1">Total Users</p>
              <h3 className="text-2xl font-bold text-white">
                {loadingStats ? <Loader2 className="w-5 h-5 animate-spin text-white/30" /> : (analytics?.totalUsers?.toLocaleString() || 0)}
              </h3>
            </div>
            <div className="p-2 bg-purple-500/10 rounded-lg text-purple-400">
              <Users className="w-5 h-5" />
            </div>
          </div>
        </div>
      </div>

      {/* User Growth Chart */}
      <div className="rounded-xl border border-white/10 bg-[#111] p-5">
        <h3 className="text-sm font-semibold text-white mb-6">User Growth (Last 30 Days)</h3>
        <div className="h-[300px] w-full">
          {loadingStats ? (
            <div className="h-full w-full flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-white/30" />
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={analytics?.userGrowth || []} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorUsers" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                <XAxis 
                  dataKey="date" 
                  stroke="#ffffff50" 
                  fontSize={12} 
                  tickLine={false} 
                  axisLine={false} 
                  tickFormatter={(val) => {
                    const d = new Date(val);
                    return `${d.getMonth()+1}/${d.getDate()}`;
                  }}
                />
                <YAxis 
                  stroke="#ffffff50" 
                  fontSize={12} 
                  tickLine={false} 
                  axisLine={false}
                />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#111', borderColor: '#ffffff20', borderRadius: '8px', color: '#fff' }}
                  itemStyle={{ color: '#c4b5fd' }}
                />
                <Area 
                  type="monotone" 
                  dataKey="totalUsers" 
                  name="Total Users"
                  stroke="#8b5cf6" 
                  strokeWidth={2}
                  fillOpacity={1} 
                  fill="url(#colorUsers)" 
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Transactions Table */}
      <div className="rounded-xl border border-white/10 bg-[#111] overflow-hidden">
        <div className="px-5 py-4 border-b border-white/10">
          <h3 className="text-sm font-semibold text-white">Recent Transactions</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-white/10 bg-white/5 text-white/60">
              <tr>
                <th className="px-6 py-3 font-medium">User</th>
                <th className="px-6 py-3 font-medium">Date</th>
                <th className="px-6 py-3 font-medium">Amount</th>
                <th className="px-6 py-3 font-medium">Plan</th>
                <th className="px-6 py-3 font-medium">Reference</th>
                <th className="px-6 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {loading && transactions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-white/50">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                    Loading transactions...
                  </td>
                </tr>
              ) : transactions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-white/50">
                    No transactions found.
                  </td>
                </tr>
              ) : (
                transactions.map((tx) => (
                  <tr key={tx._id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-medium text-white/90">
                        {tx.userId?.email || "Unknown User"}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-white/60 whitespace-nowrap">
                      {format(new Date(tx.createdAt), "MMM d, yyyy HH:mm")}
                    </td>
                    <td className="px-6 py-4 text-white/90 font-medium">
                      {formatCurrency(tx.amount)}
                    </td>
                    <td className="px-6 py-4">
                      {tx.planKey ? (
                        <span className="inline-flex items-center rounded-full bg-blue-500/10 px-2 py-1 text-xs font-medium text-blue-400 border border-blue-500/20">
                          {tx.planKey}
                        </span>
                      ) : (
                        <span className="text-white/40">-</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-white/50 font-mono text-xs">
                      {tx.reference}
                    </td>
                    <td className="px-6 py-4">
                      {tx.status === "success" ? (
                        <div className="flex items-center gap-1.5 text-emerald-400 text-sm font-medium">
                          <CheckCircle2 className="h-4 w-4" />
                          Success
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-red-400 text-sm font-medium">
                          <XCircle className="h-4 w-4" />
                          {tx.status || "Failed"}
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <button
            onClick={() => fetchTransactions(Math.max(1, page - 1))}
            disabled={page === 1 || loading}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-30 transition-colors border border-white/10"
          >
            Previous
          </button>
          <span className="text-sm text-white/50">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => fetchTransactions(Math.min(totalPages, page + 1))}
            disabled={page === totalPages || loading}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-30 transition-colors border border-white/10"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
