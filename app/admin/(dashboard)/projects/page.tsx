"use client";

import { useEffect, useState, useCallback } from "react";
import { Trash2, Search, ChevronLeft, ChevronRight, Loader2, Folder } from "lucide-react";

interface Workspace {
  _id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  owner?: { name: string; email: string };
}

export default function AdminProjectsPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isDeletingAll, setIsDeletingAll] = useState(false);

  const LIMIT = 20;
  const totalPages = Math.ceil(total / LIMIT);

  const fetchWorkspaces = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/workspaces?page=${page}&limit=${LIMIT}&search=${encodeURIComponent(search)}`);
      const data = await res.json();
      setWorkspaces(data.workspaces || []);
      setTotal(data.total || 0);
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => { fetchWorkspaces(); }, [fetchWorkspaces]);

  const deleteWorkspace = async (workspaceId: string) => {
    if (!confirm("Delete this project? This action cannot be undone.")) return;
    setDeletingId(workspaceId);
    try {
      await fetch("/api/admin/workspaces", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      setWorkspaces((prev) => prev.filter((w) => w._id !== workspaceId));
      setTotal((t) => t - 1);
    } finally {
      setDeletingId(null);
    }
  };

  const deleteAllWorkspaces = async () => {
    const confirmText = prompt("Are you sure you want to delete ALL projects? Type 'DELETE' to confirm. This action cannot be undone.");
    if (confirmText !== "DELETE") return;
    
    setIsDeletingAll(true);
    try {
      await fetch("/api/admin/workspaces", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deleteAll: true }),
      });
      setWorkspaces([]);
      setTotal(0);
      setPage(1);
    } finally {
      setIsDeletingAll(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Projects</h1>
          <p className="text-white/40 text-sm mt-1">All generated app workspaces. ({total} total)</p>
        </div>
        
        {total > 0 && (
          <button
            onClick={deleteAllWorkspaces}
            disabled={isDeletingAll}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-400 bg-red-500/10 hover:bg-red-500/20 rounded-lg transition-colors disabled:opacity-50"
          >
            {isDeletingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            Clear All Projects
          </button>
        )}
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
        <input
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search by project title..."
          className="w-full bg-[#111] border border-white/10 rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
        />
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-white/30" />
        </div>
      )}

      {!loading && workspaces.length === 0 && (
        <div className="text-center py-16 text-white/30 text-sm">No projects found.</div>
      )}

      {/* Mobile: Cards */}
      {!loading && workspaces.length > 0 && (
        <div className="sm:hidden space-y-3">
          {workspaces.map((w) => (
            <div key={w._id} className="rounded-xl bg-[#111] border border-white/10 p-4 space-y-3">
              <div className="flex items-start gap-3">
                <div className="h-8 w-8 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                  <Folder className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <span className="font-medium text-white truncate block">
                    {w.title || <span className="text-white/30 italic">Untitled</span>}
                  </span>
                  {w.owner ? (
                    <span className="text-xs text-white/40 truncate block mt-0.5">
                      {w.owner.name} ({w.owner.email})
                    </span>
                  ) : (
                    <span className="text-xs text-white/30 block mt-0.5">Unknown Owner</span>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-white/5">
                <span className="text-xs text-white/30">
                  {new Date(w.createdAt).toLocaleDateString()}
                </span>
                <button
                  onClick={() => deleteWorkspace(w._id)}
                  disabled={deletingId === w._id}
                  className="p-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20"
                >
                  {deletingId === w._id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Desktop: Table */}
      {!loading && workspaces.length > 0 && (
        <div className="hidden sm:block rounded-xl bg-[#111] border border-white/10 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-white/10">
                <tr className="text-white/40 text-xs uppercase">
                  <th className="text-left px-5 py-3 font-medium">Project</th>
                  <th className="text-left px-5 py-3 font-medium">Owner</th>
                  <th className="text-left px-5 py-3 font-medium">Created</th>
                  <th className="text-left px-5 py-3 font-medium">Last Updated</th>
                  <th className="text-right px-5 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {workspaces.map((w) => (
                  <tr key={w._id} className="hover:bg-white/[0.02] transition-colors group">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="h-8 w-8 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                          <Folder className="w-4 h-4 text-emerald-400" />
                        </div>
                        <span className="font-medium text-white truncate max-w-[200px]">
                          {w.title || <span className="text-white/30 italic">Untitled</span>}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      {w.owner ? (
                        <div>
                          <div className="text-white/70">{w.owner.name}</div>
                          <div className="text-white/30 text-xs">{w.owner.email}</div>
                        </div>
                      ) : (
                        <span className="text-white/30 text-xs">Unknown</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-white/40 text-xs">
                      {new Date(w.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-5 py-3 text-white/40 text-xs">
                      {new Date(w.updatedAt).toLocaleDateString()}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end">
                        <button
                          onClick={() => deleteWorkspace(w._id)}
                          disabled={deletingId === w._id}
                          className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all"
                          title="Delete project"
                        >
                          {deletingId === w._id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                        </button>
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
              <p className="text-xs text-white/40">Page {page} of {totalPages}</p>
              <div className="flex gap-2">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="p-1.5 rounded-lg bg-white/5 text-white/40 hover:bg-white/10 disabled:opacity-30 transition-colors">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="p-1.5 rounded-lg bg-white/5 text-white/40 hover:bg-white/10 disabled:opacity-30 transition-colors">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Mobile Pagination */}
      {!loading && totalPages > 1 && (
        <div className="sm:hidden flex items-center justify-between">
          <p className="text-xs text-white/40">Page {page} of {totalPages}</p>
          <div className="flex gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="p-1.5 rounded-lg bg-white/5 text-white/40 hover:bg-white/10 disabled:opacity-30">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="p-1.5 rounded-lg bg-white/5 text-white/40 hover:bg-white/10 disabled:opacity-30">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
