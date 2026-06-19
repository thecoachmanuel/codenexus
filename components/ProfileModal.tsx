"use client";

import { useState } from "react";
import { useAuthContext } from "@/components/AuthProvider";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  User,
  Key,
  Rocket,
  LogOut,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
  Zap,
  Shield,
} from "lucide-react";

// ─── Custom Icons ─────────────────────────────────────────────────────────────

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
    <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
    <path d="M9 18c-4.51 2-5-2-7-2" />
  </svg>
);
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { PricingModal } from "@/components/PricingModal";

// ─── Tab type ─────────────────────────────────────────────────────────────────

type Tab = "profile" | "integrations" | "plan";

// ─── Inline field ─────────────────────────────────────────────────────────────

function Field({
  label,
  id,
  type = "text",
  value,
  onChange,
  placeholder,
  disabled,
}: {
  label: string;
  id: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[11px] font-medium uppercase tracking-wider text-white/40">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="h-9 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-[13px] text-white placeholder:text-white/25 focus:border-white/25 focus:outline-none disabled:opacity-50 transition-colors"
      />
    </div>
  );
}

// ─── Status message ────────────────────────────────────────────────────────────

function StatusMsg({ type, msg }: { type: "success" | "error"; msg: string }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg px-3 py-2 text-[12px]",
        type === "success"
          ? "bg-green-500/10 text-green-400 border border-green-500/20"
          : "bg-red-500/10 text-red-400 border border-red-500/20"
      )}
    >
      {type === "success" ? (
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
      ) : (
        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
      )}
      {msg}
    </div>
  );
}

// ─── Profile Tab ──────────────────────────────────────────────────────────────

function ProfileTab() {
  const { user, refreshUser } = useAuthContext();
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  const handleSave = async () => {
    setStatus(null);
    if (newPassword && newPassword !== confirmPassword) {
      setStatus({ type: "error", msg: "New passwords do not match." });
      return;
    }

    setIsSaving(true);
    try {
      const body: Record<string, string> = { name, email };
      if (newPassword) {
        body.currentPassword = currentPassword;
        body.newPassword = newPassword;
      }

      const res = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? "Failed to update profile");

      setStatus({ type: "success", msg: "Profile updated successfully!" });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      await refreshUser();
    } catch (err) {
      setStatus({ type: "error", msg: err instanceof Error ? err.message : "Something went wrong." });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Avatar */}
      <div className="flex items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-blue-400 to-purple-500 text-xl font-bold text-white select-none ring-2 ring-white/10">
          {user?.name?.[0]?.toUpperCase() ?? "U"}
        </div>
        <div>
          <p className="text-sm font-semibold text-white">{user?.name}</p>
          <p className="text-[12px] text-white/40">{user?.email}</p>
          <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-semibold capitalize text-blue-400">
            {user?.plan ?? "free"} plan
          </span>
        </div>
      </div>

      <div className="h-px bg-white/6" />

      {/* Fields */}
      <Field label="Display name" id="prof-name" value={name} onChange={setName} placeholder="Your name" />
      <Field label="Email address" id="prof-email" type="email" value={email} onChange={setEmail} placeholder="you@email.com" />

      <div className="h-px bg-white/6" />
      <p className="text-[11px] font-semibold uppercase tracking-wider text-white/30">Change password</p>

      <Field label="Current password" id="prof-cur-pw" type="password" value={currentPassword} onChange={setCurrentPassword} placeholder="••••••••" />
      <Field label="New password" id="prof-new-pw" type="password" value={newPassword} onChange={setNewPassword} placeholder="Min. 8 characters" />
      <Field label="Confirm new password" id="prof-conf-pw" type="password" value={confirmPassword} onChange={setConfirmPassword} placeholder="••••••••" />

      {status && <StatusMsg type={status.type} msg={status.msg} />}

      <Button
        onClick={handleSave}
        disabled={isSaving}
        className="h-9 w-full rounded-lg bg-white text-[13px] font-semibold text-black hover:bg-white/90 active:scale-95 transition-all disabled:opacity-60"
      >
        {isSaving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
        Save changes
      </Button>
    </div>
  );
}

// ─── Integrations Tab ─────────────────────────────────────────────────────────

function IntegrationRow({
  icon: Icon,
  label,
  description,
  tokenKey,
  placeholder,
}: {
  icon: React.ElementType;
  label: string;
  description: string;
  tokenKey: string;
  placeholder: string;
}) {
  const [token, setToken] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  const handleSave = async () => {
    if (!token.trim()) return;
    setIsSaving(true);
    setStatus(null);
    try {
      const res = await fetch(`/api/user/${tokenKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? "Failed to save token");
      setStatus({ type: "success", msg: "Token saved & validated!" });
      setToken("");
    } catch (err) {
      setStatus({ type: "error", msg: err instanceof Error ? err.message : "Invalid token" });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-white/8 bg-white/3 p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5">
          <Icon className="h-4 w-4 text-white/70" />
        </div>
        <div>
          <p className="text-[13px] font-semibold text-white">{label}</p>
          <p className="text-[11px] text-white/40">{description}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={placeholder}
          className="h-8 flex-1 rounded-lg border border-white/10 bg-white/5 px-3 text-[12px] text-white placeholder:text-white/25 focus:border-white/25 focus:outline-none transition-colors"
        />
        <Button
          size="sm"
          onClick={handleSave}
          disabled={isSaving || !token.trim()}
          className="h-8 rounded-lg bg-white/10 px-3 text-[12px] text-white hover:bg-white/20 disabled:opacity-50 transition-all"
        >
          {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
        </Button>
      </div>
      {status && <StatusMsg type={status.type} msg={status.msg} />}
    </div>
  );
}

function IntegrationsTab() {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12px] text-white/40 leading-relaxed">
        Connect external services to unlock Export to GitHub and 1-Click Vercel deployment features.
      </p>
      <IntegrationRow
        icon={GithubIcon}
        label="GitHub"
        description="Export your apps to GitHub repositories"
        tokenKey="github-token"
        placeholder="github_pat_xxxx…"
      />
      <IntegrationRow
        icon={Rocket}
        label="Vercel"
        description="Deploy your apps live with one click"
        tokenKey="vercel-token"
        placeholder="xxxxxxxxxxxxxxxxxxxxxxxx"
      />
    </div>
  );
}

// ─── Plan Tab ─────────────────────────────────────────────────────────────────

function PlanTab() {
  const { user } = useAuthContext();

  const plans = [
    { key: "free", label: "Free", credits: 10, price: "$0/mo", features: ["10 credits", "Basic generation"] },
    { key: "starter", label: "Starter", credits: 50, price: "$9/mo", features: ["50 credits", "Priority generation"] },
    { key: "pro", label: "Pro", credits: 150, price: "$29/mo", features: ["150 credits", "Agent improvements", "Priority support"] },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/4 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <Zap className="h-4 w-4 text-yellow-400" />
          <div>
            <p className="text-[12px] font-semibold text-white">{user?.credits ?? 0} credits remaining</p>
            <p className="text-[11px] text-white/40 capitalize">{user?.plan ?? "free"} plan</p>
          </div>
        </div>
        <span className="rounded-full bg-blue-500/15 px-2.5 py-1 text-[11px] font-semibold capitalize text-blue-400">
          {user?.plan ?? "free"}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3">
        {plans.map((plan) => {
          const isCurrent = user?.plan === plan.key;
          return (
            <div
              key={plan.key}
              className={cn(
                "flex items-center justify-between rounded-xl border p-4 transition-colors",
                isCurrent
                  ? "border-blue-500/40 bg-blue-500/5"
                  : "border-white/8 bg-white/3"
              )}
            >
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-[13px] font-semibold text-white">{plan.label}</p>
                  {isCurrent && (
                    <span className="rounded-full bg-blue-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-blue-400">Current</span>
                  )}
                </div>
                <p className="text-[11px] text-white/40">{plan.features.join(" · ")}</p>
              </div>
              <div className="flex items-center gap-3">
                <p className="text-[12px] font-semibold text-white/70">{plan.price}</p>
                {!isCurrent && (
                  <PricingModal>
                    <button className="flex items-center gap-1 rounded-lg bg-white/8 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-white/15 transition-colors">
                      Upgrade <ChevronRight className="h-3 w-3" />
                    </button>
                  </PricingModal>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main Modal ───────────────────────────────────────────────────────────────

interface ProfileModalProps {
  children: React.ReactNode;
}

export function ProfileModal({ children }: ProfileModalProps) {
  const { user, signOut } = useAuthContext();
  const [activeTab, setActiveTab] = useState<Tab>("profile");
  const [isSigningOut, setIsSigningOut] = useState(false);

  const tabs: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: "profile", label: "Profile", icon: User },
    { key: "integrations", label: "Integrations", icon: Shield },
    { key: "plan", label: "Plan", icon: Zap },
  ];

  const handleSignOut = async () => {
    setIsSigningOut(true);
    toast.promise(signOut(), { loading: "Signing out…", success: "Signed out!", error: "Something went wrong." });
  };

  if (!user) return <>{children}</>;

  return (
    <Dialog>
      <DialogTrigger className="cursor-pointer">{children}</DialogTrigger>
      <DialogContent className="border-white/10 bg-[#0d0d0d] p-0 text-white sm:max-w-[460px] overflow-hidden">
        <DialogHeader className="border-b border-white/6 px-5 py-4">
          <DialogTitle className="text-[15px] font-semibold text-white">Account settings</DialogTitle>
        </DialogHeader>

        <div className="flex">
          {/* Sidebar */}
          <div className="flex w-36 shrink-0 flex-col gap-0.5 border-r border-white/6 p-3">
            {tabs.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[12px] font-medium transition-colors",
                  activeTab === key
                    ? "bg-white/8 text-white"
                    : "text-white/50 hover:bg-white/5 hover:text-white/80"
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                {label}
              </button>
            ))}

            <div className="mt-auto pt-4">
              <button
                onClick={handleSignOut}
                disabled={isSigningOut}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[12px] font-medium text-red-400/80 hover:bg-red-500/10 hover:text-red-400 transition-colors disabled:opacity-50"
              >
                {isSigningOut ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <LogOut className="h-3.5 w-3.5 shrink-0" />
                )}
                Sign out
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-5" style={{ maxHeight: "70vh" }}>
            {activeTab === "profile" && <ProfileTab />}
            {activeTab === "integrations" && <IntegrationsTab />}
            {activeTab === "plan" && <PlanTab />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
