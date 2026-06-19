"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Lock,
  Globe,
  Key,
  Trash2,
  ArrowRight,
  Folder,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { FileData } from "@/types/workspace";

interface GitHubExportModalProps {
  children: React.ReactNode;
  fileData: FileData | null;
  appTitle: string | null;
}

type Step = "connect" | "form" | "exporting" | "success";

interface GitHubAccount {
  login: string;
  avatar: string;
}

const GithubIcon = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.24c3-.34 6-1.53 6-6.76a5.2 5.2 0 0 0-1.39-3.5 4.9 4.9 0 0 0-.13-3.4s-1.12-.35-3.66 1.2a12.1 12.1 0 0 0-6.6 0C5.72 2.7 4.6 3.05 4.6 3.05a4.9 4.9 0 0 0-.13 3.4A5.2 5.2 0 0 0 3 9.76c0 5.23 3 6.42 6 6.76-.7.63-1 1.5-1 3.24v4" />
  </svg>
);

export function GitHubExportModal({
  children,
  fileData,
  appTitle,
}: GitHubExportModalProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("connect");

  // GitHub account state
  const [account, setAccount] = useState<GitHubAccount | null>(null);
  const [isCheckingToken, setIsCheckingToken] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [tokenError, setTokenError] = useState("");
  const [isSavingToken, setIsSavingToken] = useState(false);

  // Export form state
  const [repoName, setRepoName] = useState("");
  const [description, setDescription] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [result, setResult] = useState<{ url: string; repoName: string; fileCount: number } | null>(null);

  // On open, check if GitHub is already connected
  const checkConnection = useCallback(async () => {
    setIsCheckingToken(true);
    try {
      const res = await fetch("/api/user/github-token");
      const data = await res.json() as { connected: boolean; login?: string; avatar?: string };
      if (data.connected && data.login) {
        setAccount({ login: data.login, avatar: data.avatar ?? "" });
        setStep("form");
      } else {
        setStep("connect");
      }
    } catch {
      setStep("connect");
    } finally {
      setIsCheckingToken(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      // Pre-fill repo name from app title
      const slug = (appTitle ?? "my-app")
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
      setRepoName(slug);
      checkConnection();
    } else {
      // Reset on close (keep account state to avoid re-checking each time)
      setTokenInput("");
      setTokenError("");
      setExportError("");
      setResult(null);
      if (!result) setStep(account ? "form" : "connect");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleSaveToken = async () => {
    if (!tokenInput.trim()) return;
    setTokenError("");
    setIsSavingToken(true);
    try {
      const res = await fetch("/api/user/github-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tokenInput.trim() }),
      });
      const data = await res.json() as { login?: string; avatar?: string; message?: string };
      if (!res.ok) {
        setTokenError(data.message ?? "Failed to connect GitHub account.");
        return;
      }
      setAccount({ login: data.login!, avatar: data.avatar ?? "" });
      setTokenInput("");
      setStep("form");
    } catch {
      setTokenError("Network error. Please try again.");
    } finally {
      setIsSavingToken(false);
    }
  };

  const handleDisconnect = async () => {
    await fetch("/api/user/github-token", { method: "DELETE" });
    setAccount(null);
    setStep("connect");
  };

  const handleExport = async () => {
    if (!repoName.trim() || !fileData) return;
    setExportError("");
    setIsExporting(true);
    setStep("exporting");
    try {
      const res = await fetch("/api/github/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoName: repoName.trim(),
          description: description.trim(),
          isPrivate,
          files: fileData.files,
          appTitle: appTitle ?? repoName,
        }),
      });
      const data = await res.json() as { url?: string; repoName?: string; fileCount?: number; message?: string };
      if (!res.ok) {
        setExportError(data.message ?? "Export failed. Please try again.");
        setStep("form");
        return;
      }
      setResult({ url: data.url!, repoName: data.repoName!, fileCount: data.fileCount! });
      setStep("success");
    } catch {
      setExportError("Network error. Please try again.");
      setStep("form");
    } finally {
      setIsExporting(false);
    }
  };

  const fileCount = fileData ? Object.keys(fileData.files ?? {}).length : 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v && step === "success") {
          setStep(account ? "form" : "connect");
          setResult(null);
        }
      }}
    >
      <DialogTrigger className="cursor-pointer">{children}</DialogTrigger>
      <DialogContent className="border-white/15 bg-[#0d0d0d] text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5 text-white">
            <GithubIcon className="h-5 w-5" />
            Export to GitHub
          </DialogTitle>
          <DialogDescription className="text-white/50">
            Push your generated app directly to a new GitHub repository.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-1 space-y-4">
          {/* ── STEP: CHECKING ───────────────────────────────────────────── */}
          {isCheckingToken && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-white/30" />
            </div>
          )}

          {/* ── STEP: CONNECT ────────────────────────────────────────────── */}
          {!isCheckingToken && step === "connect" && (
            <div className="space-y-4">
              {/* Instructions */}
              <div className="rounded-xl border border-white/10 bg-white/4 p-4 space-y-3">
                <p className="text-sm font-medium text-white/80">
                  Connect your GitHub account
                </p>
                <ol className="space-y-2 text-[12px] text-white/50 leading-relaxed list-none">
                  <li className="flex gap-2">
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] font-bold text-white/60">1</span>
                    Go to <a href="https://github.com/settings/tokens/new?description=Crevo+Export&scopes=repo" target="_blank" rel="noopener noreferrer" className="text-blue-400/80 hover:text-blue-300 underline underline-offset-2">GitHub → Settings → Tokens</a>
                  </li>
                  <li className="flex gap-2">
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] font-bold text-white/60">2</span>
                    Click <strong className="text-white/70">"Generate new token (classic)"</strong>
                  </li>
                  <li className="flex gap-2">
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] font-bold text-white/60">3</span>
                    Enable the <code className="rounded bg-white/10 px-1 text-white/70">repo</code> scope and generate
                  </li>
                  <li className="flex gap-2">
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] font-bold text-white/60">4</span>
                    Paste the token below
                  </li>
                </ol>
              </div>

              {/* Token input */}
              <div className="space-y-1.5">
                <label className="text-[12px] font-medium text-white/60">
                  Personal Access Token
                </label>
                <div className="relative">
                  <Key className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/30" />
                  <input
                    type="password"
                    value={tokenInput}
                    onChange={(e) => { setTokenInput(e.target.value); setTokenError(""); }}
                    onKeyDown={(e) => e.key === "Enter" && handleSaveToken()}
                    placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                    className="w-full rounded-xl border border-white/15 bg-white/5 pl-9 pr-4 py-2.5 text-sm text-white placeholder:text-white/25 focus:border-white/30 focus:outline-none focus:ring-1 focus:ring-white/15 transition-colors"
                  />
                </div>
                {tokenError && (
                  <div className="flex items-center gap-2 text-[12px] text-red-400/80">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    {tokenError}
                  </div>
                )}
              </div>

              <Button
                onClick={handleSaveToken}
                disabled={!tokenInput.trim() || isSavingToken}
                className="w-full rounded-xl bg-white text-black font-semibold hover:bg-white/90 active:scale-[0.98] disabled:opacity-50"
              >
                {isSavingToken ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Connecting…</>
                ) : (
                  <><GithubIcon className="h-4 w-4" /> Connect GitHub Account</>
                )}
              </Button>
            </div>
          )}

          {/* ── STEP: FORM ───────────────────────────────────────────────── */}
          {!isCheckingToken && step === "form" && (
            <div className="space-y-4">
              {/* Connected account badge */}
              {account && (
                <div className="flex items-center justify-between rounded-xl border border-emerald-500/20 bg-emerald-500/8 px-3.5 py-2.5">
                  <div className="flex items-center gap-2.5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {account.avatar && <img src={account.avatar} alt={account.login} className="h-6 w-6 rounded-full" />}
                    <div>
                      <p className="text-[11px] text-emerald-400/70 font-medium">Connected as</p>
                      <p className="text-sm text-emerald-300 font-semibold leading-tight">@{account.login}</p>
                    </div>
                  </div>
                  <button
                    onClick={handleDisconnect}
                    title="Disconnect GitHub"
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-white/30 hover:bg-white/10 hover:text-white/60 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              {/* File summary */}
              <div className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/4 px-3.5 py-2.5">
                <Folder className="h-4 w-4 text-white/30 shrink-0" />
                <p className="text-[12px] text-white/50">
                  <span className="font-semibold text-white/70">{fileCount} file{fileCount !== 1 ? "s" : ""}</span> will be exported to a new repo
                </p>
              </div>

              {/* Repo name */}
              <div className="space-y-1.5">
                <label className="text-[12px] font-medium text-white/60">Repository name</label>
                <input
                  type="text"
                  value={repoName}
                  onChange={(e) => { setRepoName(e.target.value); setExportError(""); }}
                  placeholder="my-crevo-app"
                  className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-white/25 focus:border-white/30 focus:outline-none focus:ring-1 focus:ring-white/15 transition-colors"
                />
              </div>

              {/* Description */}
              <div className="space-y-1.5">
                <label className="text-[12px] font-medium text-white/60">
                  Description <span className="text-white/30">(optional)</span>
                </label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="A short description of your app…"
                  className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-white/25 focus:border-white/30 focus:outline-none focus:ring-1 focus:ring-white/15 transition-colors"
                />
              </div>

              {/* Visibility toggle */}
              <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/4 p-1">
                <button
                  onClick={() => setIsPrivate(false)}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium transition-all",
                    !isPrivate
                      ? "bg-white/10 text-white shadow-sm"
                      : "text-white/40 hover:text-white/60"
                  )}
                >
                  <Globe className="h-3.5 w-3.5" />
                  Public
                </button>
                <button
                  onClick={() => setIsPrivate(true)}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium transition-all",
                    isPrivate
                      ? "bg-white/10 text-white shadow-sm"
                      : "text-white/40 hover:text-white/60"
                  )}
                >
                  <Lock className="h-3.5 w-3.5" />
                  Private
                </button>
              </div>

              {/* Error */}
              {exportError && (
                <div className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3.5 py-3 text-[12px] text-red-400">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {exportError}
                </div>
              )}

              <Button
                onClick={handleExport}
                disabled={!repoName.trim() || isExporting || !fileData}
                className="w-full rounded-xl bg-white text-black font-semibold hover:bg-white/90 active:scale-[0.98] disabled:opacity-50"
              >
                Create Repository
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          )}

          {/* ── STEP: EXPORTING ──────────────────────────────────────────── */}
          {step === "exporting" && (
            <div className="flex flex-col items-center justify-center gap-4 py-10">
              <div className="relative">
                <div className="h-16 w-16 rounded-full border-2 border-white/10 bg-white/5 flex items-center justify-center">
                  <GithubIcon className="h-8 w-8 text-white/40" />
                </div>
                <div className="absolute inset-0 rounded-full border-2 border-t-white/60 animate-spin" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-white/80">Pushing to GitHub…</p>
                <p className="mt-1 text-[12px] text-white/40">Creating blobs, tree and commit</p>
              </div>
            </div>
          )}

          {/* ── STEP: SUCCESS ─────────────────────────────────────────────── */}
          {step === "success" && result && (
            <div className="space-y-4">
              <div className="flex flex-col items-center gap-3 py-6 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/15">
                  <CheckCircle2 className="h-7 w-7 text-emerald-400" />
                </div>
                <div>
                  <p className="font-semibold text-white">Repository created!</p>
                  <p className="mt-1 text-[12px] text-white/50">
                    {result.fileCount} file{result.fileCount !== 1 ? "s" : ""} pushed to <span className="text-white/70 font-medium">{result.repoName}</span>
                  </p>
                </div>
              </div>

              <a
                href={result.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/6 py-3 text-sm font-medium text-white hover:bg-white/10 transition-colors"
              >
                <GithubIcon className="h-4 w-4" />
                View on GitHub
                <ExternalLink className="h-3.5 w-3.5 text-white/40" />
              </a>

              <Button
                onClick={() => {
                  setStep("form");
                  setResult(null);
                  setExportError("");
                }}
                variant="ghost"
                className="w-full text-white/40 hover:text-white/60"
              >
                Export another repository
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
