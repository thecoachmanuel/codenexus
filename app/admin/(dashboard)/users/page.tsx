"use client";

import { useEffect, useState, useCallback } from "react";
import { Trash2, Pencil, X, Check, Search, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

interface User {
  _id: string;
  name: string;
  email: string;
  plan: "free" | "starter" | "pro";
  credits: number;
  createdAt: string;
}

const PLAN_COLORS: Record<string, string> = {
  free: "bg-white/10 text-white/60",
  starter: "bg-blue-500/10 text-blue-400",
  pro: "bg-purple-500/10 text-purple-400",
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPlan, setEditPlan] = useState<"free" | "starter" | "pro">("free");
  const [editCredits, setEditCredits] = useState<number>(0);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const LIMIT = 20;
  const totalPages = Math.ceil(total / LIMIT);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/users?page=${page}&limit=${LIMIT}&search=${encodeURIComponent(search)}`);
      const data = await res.json();
      setUsers(data.users || []);
      setTotal(data.total || 0);
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const startEdit = (u: User) => {
    setEditingId(u._id);
    setEditPlan(u.plan);
    setEditCredits(u.credits);
  };

  const cancelEdit = () => setEditingId(null);

  const saveEdit = async (userId: string) => {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, plan: editPlan, credits: editCredits }),
      });
      const data = await res.json();
      if (data.user) {
        setUsers((prev) => prev.map((u) => u._id === userId ? data.user : u));
        setEditingId(null);
      }
    } finally {
      setSaving(false);
    }
  };

  const deleteUser = async (userId: string) => {
    if (!confirm("Are you sure? This will permanently delete the user and all their projects.")) return;
    setDeletingId(userId);
    try {
      await fetch("/api/admin/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      setUsers((prev) => prev.filter((u) => u._id !== userId));
      setTotal((t) => t - 1);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Users</h1>
        <p className="text-white/40 text-sm mt-1">Manage all registered users. ({total} total)</p>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
        <input
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search by name or email..."
          className="w-full bg-[#111] border border-white/10 rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
        />
      </div>

      {/* Table */}
      <div className="rounded-xl bg-[#111] border border-white/10 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-white/10">
              <tr className="text-white/40 text-xs uppercase">
                <th className="text-left px-5 py-3 font-medium">User</th>
                <th className="text-left px-5 py-3 font-medium">Plan</th>
                <th className="text-left px-5 py-3 font-medium">Credits</th>
                <th className="text-left px-5 py-3 font-medium">Joined</th>
                <th className="text-right px-5 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-16 text-center">
                    <Loader2 className="w-6 h-6 animate-spin text-white/30 mx-auto" />
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-16 text-center text-white/30 text-sm">No users found.</td>
                </tr>
              ) : users.map((u) => (
                <tr key={u._id} className="hover:bg-white/[0.02] transition-colors group">
                  <td className="px-5 py-3">
                    <div className="font-medium text-white">{u.name}</div>
                    <div className="text-white/40 text-xs">{u.email}</div>
                  </td>
                  <td className="px-5 py-3">
                    {editingId === u._id ? (
                      <select
                        value={editPlan}
                        onChange={(e) => setEditPlan(e.target.value as "free" | "starter" | "pro")}
                        className="bg-black/50 border border-white/20 rounded px-2 py-1 text-xs text-white focus:outline-none"
                      >
                        <option value="free">Free</option>
                        <option value="starter">Starter</option>
                        <option value="pro">Pro</option>
                      </select>
                    ) : (
                      <span className={`px-2 py-0.5 rounded-full text-xs capitalize ${PLAN_COLORS[u.plan]}`}>
                        {u.plan}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-white/70">
                    {editingId === u._id ? (
                      <input
                        type="number"
                        value={editCredits}
                        onChange={(e) => setEditCredits(Number(e.target.value))}
                        className="w-20 bg-black/50 border border-white/20 rounded px-2 py-1 text-xs text-white focus:outline-none"
                        min={0}
                      />
                    ) : (
                      u.credits
                    )}
                  </td>
                  <td className="px-5 py-3 text-white/40 text-xs">
                    {new Date(u.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-2">
                      {editingId === u._id ? (
                        <>
                          <button
                            onClick={() => saveEdit(u._id)}
                            disabled={saving}
                            className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                            title="Save"
                          >
                            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="p-1.5 rounded-lg bg-white/5 text-white/40 hover:bg-white/10 transition-colors"
                            title="Cancel"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => startEdit(u)}
                            className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-all"
                            title="Edit"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => deleteUser(u._id)}
                            disabled={deletingId === u._id}
                            className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all"
                            title="Delete user"
                          >
                            {deletingId === u._id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-white/10">
            <p className="text-xs text-white/40">
              Page {page} of {totalPages}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-1.5 rounded-lg bg-white/5 text-white/40 hover:bg-white/10 disabled:opacity-30 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="p-1.5 rounded-lg bg-white/5 text-white/40 hover:bg-white/10 disabled:opacity-30 transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
