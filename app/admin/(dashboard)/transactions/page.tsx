"use client";

import { useState, useEffect } from "react";
import { format } from "date-fns";
import { Loader2, RefreshCw, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

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
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Transactions</h1>
          <p className="text-sm text-white/50">Track all successful and failed payment attempts.</p>
        </div>
        <button
          onClick={() => fetchTransactions(page)}
          disabled={loading}
          className="flex items-center gap-2 rounded-md bg-white/5 px-4 py-2 text-sm font-medium text-white hover:bg-white/10 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          Refresh
        </button>
      </div>

      <div className="rounded-xl border border-white/10 bg-[#111] overflow-hidden">
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
                      {/* Assuming Paystack stores in kobo/cents. Format accordingly. */}
                      {(tx.amount / 100).toLocaleString("en-US", {
                        style: "currency",
                        currency: tx.currency || "USD",
                      })}
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
