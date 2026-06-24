"use client";

import { useState } from "react";
import { GitBranch, ArrowRight, Loader2, AlertCircle, Lock, FileCode2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { FileData } from "@/types/workspace";
import { PricingModal } from "@/components/PricingModal";

interface GitHubImportModalProps {
  children: React.ReactNode;
  isProUser: boolean;
  onImport: (workspaceId: string, repoName: string) => void;
}

export function GitHubImportModal({ children, isProUser, onImport }: GitHubImportModalProps) {
  const [open, setOpen] = useState(false);
  const [repoUrl, setRepoUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ fileCount: number; truncated: boolean } | null>(null);

  const handleImport = async () => {
    if (!repoUrl.trim()) return;
    setError("");
    setResult(null);
    setIsLoading(true);

    try {
      const res = await fetch("/api/github/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl: repoUrl.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.message ?? "Import failed. Please try again.");
        return;
      }

      setResult({ fileCount: data.fileCount, truncated: data.truncated });

      // Short delay so user sees the success state
      setTimeout(() => {
        onImport(data.workspaceId, data.title);
        setOpen(false);
        setRepoUrl("");
        setResult(null);
      }, 800);
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleImport();
  };

  // Non-pro users see an upgrade prompt instead
  if (!isProUser) {
    return (
      <PricingModal reason="upgrade">
        {children}
      </PricingModal>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setError(""); setRepoUrl(""); setResult(null); } }}>
      <DialogTrigger className="cursor-pointer">{children}</DialogTrigger>
      <DialogContent className="border-white/20 bg-[#0a0a0a] text-white sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <GitBranch className="h-5 w-5" />
            Import from GitHub
          </DialogTitle>
          <DialogDescription className="text-white/60">
            Paste a public GitHub repository URL. The files will load directly into your workspace so you can continue editing with AI.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 space-y-4">
          {/* URL Input */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-white/70">
              Repository URL
            </label>
            <input
              type="url"
              value={repoUrl}
              onChange={(e) => { setRepoUrl(e.target.value); setError(""); }}
              onKeyDown={handleKeyDown}
              placeholder="https://github.com/owner/repository"
              disabled={isLoading}
              className="w-full rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/30 focus:border-white/40 focus:outline-none focus:ring-1 focus:ring-white/20 transition-colors disabled:opacity-50"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2.5 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          {/* Success result */}
          {result && (
            <div className="flex items-start gap-2.5 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
              <FileCode2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Imported {result.fileCount} files successfully!
                {result.truncated && " (large repo — capped at limit)"}
              </span>
            </div>
          )}

          {/* Info note */}
          <div className="flex items-start gap-2 rounded-xl border border-white/10 bg-white/4 px-4 py-3">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/40" />
            <p className="text-xs text-white/50 leading-relaxed">
              Only <strong className="text-white/70">public repositories</strong> are supported. Up to 50 source files are imported (JS, TS, CSS, HTML, JSON, etc). Binary files and <code className="text-white/60">node_modules</code> are automatically skipped.
            </p>
          </div>

          {/* CTA */}
          <Button
            onClick={handleImport}
            disabled={!repoUrl.trim() || isLoading || !!result}
            className={cn(
              "w-full rounded-xl font-semibold transition-all",
              "bg-white text-black hover:bg-white/90 active:scale-[0.98]",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Fetching repository…
              </>
            ) : result ? (
              <>
                <FileCode2 className="h-4 w-4" />
                Opening workspace…
              </>
            ) : (
              <>
                Import Repository
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
