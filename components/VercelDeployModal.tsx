import { useState, useCallback, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowRight, CheckCircle2, TriangleAlert, Rocket } from "lucide-react";
import type { FileData } from "@/types/workspace";

type Step = "connect" | "form" | "deploying" | "success";

interface VercelAccount {
  username: string;
  email: string;
}

interface VercelDeployModalProps {
  children: React.ReactNode;
  fileData: FileData | null | undefined;
  appTitle?: string | null;
}

export function VercelDeployModal({
  children,
  fileData,
  appTitle,
}: VercelDeployModalProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("connect");

  // Vercel account state
  const [account, setAccount] = useState<VercelAccount | null>(null);
  const [isCheckingToken, setIsCheckingToken] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [tokenError, setTokenError] = useState("");
  const [isSavingToken, setIsSavingToken] = useState(false);

  // Deploy state
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployError, setDeployError] = useState("");
  const [result, setResult] = useState<{ url: string; deploymentId: string; name: string } | null>(null);

  // On open, check if Vercel is already connected
  const checkConnection = useCallback(async () => {
    setIsCheckingToken(true);
    try {
      const res = await fetch("/api/user/vercel-token");
      const data = await res.json() as { connected: boolean; username?: string; email?: string };
      if (data.connected && data.username) {
        setAccount({ username: data.username, email: data.email ?? "" });
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
      checkConnection();
    } else {
      setTokenInput("");
      setTokenError("");
      setDeployError("");
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
      const res = await fetch("/api/user/vercel-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tokenInput.trim() }),
      });
      const data = await res.json() as { username?: string; email?: string; message?: string };
      if (!res.ok) {
        setTokenError(data.message ?? "Failed to connect Vercel account.");
        return;
      }
      setAccount({ username: data.username!, email: data.email ?? "" });
      setTokenInput("");
      setStep("form");
    } catch {
      setTokenError("Network error. Please try again.");
    } finally {
      setIsSavingToken(false);
    }
  };

  const handleDisconnect = async () => {
    await fetch("/api/user/vercel-token", { method: "DELETE" });
    setAccount(null);
    setStep("connect");
  };

  const handleDeploy = async () => {
    if (!fileData) return;
    setDeployError("");
    setIsDeploying(true);
    setStep("deploying");
    try {
      const res = await fetch("/api/deploy/vercel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileData,
          appTitle: appTitle ?? "ai-app",
        }),
      });
      const data = await res.json() as { url?: string; deploymentId?: string; name?: string; message?: string };
      if (!res.ok) {
        setDeployError(data.message ?? "Deployment failed. Please try again.");
        setStep("form");
        return;
      }
      setResult({ url: data.url!, deploymentId: data.deploymentId!, name: data.name! });
      setStep("success");
    } catch {
      setDeployError("Network error. Please try again.");
      setStep("form");
    } finally {
      setIsDeploying(false);
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
            <Rocket className="h-5 w-5" />
            1-Click Deploy to Vercel
          </DialogTitle>
          <DialogDescription className="text-white/50">
            Instantly host your app on Vercel without leaving the editor.
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
              <div className="rounded-xl border border-white/10 bg-white/4 p-4 space-y-3">
                <p className="text-sm font-medium text-white/80">
                  Connect your Vercel account
                </p>
                <ol className="space-y-2 text-[12px] text-white/50 leading-relaxed list-none">
                  <li className="flex gap-2">
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] font-bold text-white/60">1</span>
                    Go to <a href="https://vercel.com/account/tokens" target="_blank" rel="noopener noreferrer" className="text-blue-400/80 hover:text-blue-300 underline underline-offset-2">Vercel → Account Settings → Tokens</a>
                  </li>
                  <li className="flex gap-2">
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] font-bold text-white/60">2</span>
                    Create a new token with "Full Account" scope
                  </li>
                  <li className="flex gap-2">
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] font-bold text-white/60">3</span>
                    Paste the token below
                  </li>
                </ol>
              </div>

              <div className="space-y-1.5">
                <label className="text-[12px] font-medium text-white/60">
                  Vercel Access Token
                </label>
                <input
                  type="password"
                  value={tokenInput}
                  onChange={(e) => {
                    setTokenInput(e.target.value);
                    setTokenError("");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && tokenInput.trim()) {
                      e.preventDefault();
                      handleSaveToken();
                    }
                  }}
                  placeholder="vCEL_xxxxxxxxxxxxxxxxx"
                  className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm text-white placeholder:text-white/20 focus:border-white/30 focus:outline-none"
                />
              </div>

              {tokenError && (
                <div className="flex items-center gap-1.5 text-[12px] text-red-400">
                  <TriangleAlert className="h-3.5 w-3.5" />
                  {tokenError}
                </div>
              )}

              <Button
                onClick={handleSaveToken}
                disabled={!tokenInput.trim() || isSavingToken}
                className="w-full bg-white text-black hover:bg-white/90"
              >
                {isSavingToken ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Connect Vercel
              </Button>
            </div>
          )}

          {/* ── STEP: DEPLOY ──────────────────────────────────────────────── */}
          {!isCheckingToken && step === "form" && account && (
            <div className="space-y-5">
              <div className="flex items-center justify-between rounded-xl border border-white/10 bg-black p-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white font-bold uppercase">
                    {account.username.charAt(0)}
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-white/90 leading-tight">
                      {account.username}
                    </span>
                    <span className="text-[11px] text-white/40">
                      {account.email}
                    </span>
                  </div>
                </div>
                <button
                  onClick={handleDisconnect}
                  className="text-[11px] text-white/40 hover:text-white transition-colors underline underline-offset-2"
                >
                  Disconnect
                </button>
              </div>

              <div className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-1 text-sm text-white/70">
                You are about to instantly deploy <strong>{fileCount} files</strong> to Vercel. This app will be live on the internet immediately.
              </div>

              {deployError && (
                <div className="flex items-center gap-1.5 text-[12px] text-red-400">
                  <TriangleAlert className="h-3.5 w-3.5" />
                  {deployError}
                </div>
              )}

              <Button
                onClick={handleDeploy}
                className="w-full bg-white text-black hover:bg-white/90"
              >
                Deploy Now <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
            </div>
          )}

          {/* ── STEP: DEPLOYING ───────────────────────────────────────────── */}
          {step === "deploying" && (
            <div className="flex flex-col items-center justify-center py-10 space-y-4">
              <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
              <div className="space-y-1 text-center">
                <p className="text-sm font-medium text-white/90">
                  Deploying to Vercel…
                </p>
                <p className="text-[12px] text-white/50">
                  This usually takes less than 5 seconds.
                </p>
              </div>
            </div>
          )}

          {/* ── STEP: SUCCESS ────────────────────────────────────────────── */}
          {step === "success" && result && (
            <div className="flex flex-col items-center justify-center py-6 space-y-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10">
                <CheckCircle2 className="h-6 w-6 text-green-500" />
              </div>
              <div className="space-y-1 text-center">
                <p className="text-base font-medium text-white/90">
                  Deployment Successful!
                </p>
                <p className="text-sm text-white/50">
                  Your app is now live on Vercel.
                </p>
              </div>

              <div className="w-full rounded-xl border border-white/10 bg-black p-4 space-y-3 mt-2">
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] text-white/40 font-medium uppercase tracking-wider">
                    Live URL
                  </span>
                  <a
                    href={result.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-400 hover:text-blue-300 hover:underline flex items-center gap-1 truncate"
                  >
                    {result.url}
                  </a>
                </div>
              </div>

              <Button
                onClick={() => setOpen(false)}
                className="w-full mt-4 bg-white/10 text-white hover:bg-white/20 border border-white/10"
              >
                Done
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
