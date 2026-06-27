"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Globe, X, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface EditSubdomainModalProps {
  children: React.ReactNode;
  workspaceId: string;
  currentSubdomain: string;
  onSuccess: (newSubdomain: string) => void;
}

export function EditSubdomainModal({ children, workspaceId, currentSubdomain, onSuccess }: EditSubdomainModalProps) {
  const [open, setOpen] = useState(false);
  const [subdomain, setSubdomain] = useState(currentSubdomain);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync state when opened
  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) {
      setSubdomain(currentSubdomain);
      setError(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const res = await fetch(`/api/workspace/${workspaceId}/subdomain`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subdomain }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to update subdomain");
        return;
      }

      toast.success("URL updated successfully!");
      onSuccess(data.subdomain);
      setOpen(false);
    } catch (err: any) {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Trigger asChild>{children}</Dialog.Trigger>
      
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        
        <Dialog.Content className="fixed left-[50%] top-[50%] z-50 grid w-full max-w-md translate-x-[-50%] translate-y-[-50%] gap-4 border border-white/10 bg-[#111] p-6 shadow-2xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 sm:rounded-2xl">
          <div className="flex flex-col gap-1.5 text-center sm:text-left">
            <Dialog.Title className="text-xl font-semibold leading-none tracking-tight text-white flex items-center gap-2">
              <Globe className="h-5 w-5 text-indigo-400" />
              Edit App URL
            </Dialog.Title>
            <Dialog.Description className="text-sm text-white/60">
              Customize your live app's web address. Must be unique across all Crevo AI apps.
            </Dialog.Description>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6 py-4">
            {error && (
              <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}
            
            <div className="space-y-2">
              <label className="text-sm font-medium text-white/80">
                Subdomain
              </label>
              <div className="flex items-center rounded-xl border border-white/20 bg-[#0a0a0a] overflow-hidden focus-within:ring-1 focus-within:ring-white/40 focus-within:border-white/40 transition-all">
                <span className="px-3 text-white/40 text-sm select-none border-r border-white/10 bg-white/5 py-3">
                  https://
                </span>
                <input
                  type="text"
                  value={subdomain}
                  onChange={(e) => setSubdomain(e.target.value.toLowerCase())}
                  placeholder="my-cool-app"
                  pattern="[a-z0-9-]+"
                  maxLength={30}
                  minLength={3}
                  className="flex-1 bg-transparent px-3 py-3 text-sm text-white focus:outline-none placeholder:text-white/20"
                />
                <span className="px-3 text-white/40 text-sm select-none bg-white/5 py-3">
                  .crevoai.website
                </span>
              </div>
              <p className="text-xs text-white/40 mt-2">
                Use only lowercase letters, numbers, and hyphens (3-30 characters).
              </p>
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2">
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="mt-2 sm:mt-0 inline-flex items-center justify-center rounded-xl border border-white/20 bg-transparent px-4 py-2.5 text-sm font-medium text-white/80 hover:bg-white/10 hover:text-white transition-colors"
                >
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="submit"
                disabled={isSubmitting || subdomain === currentSubdomain || subdomain.trim() === ""}
                className="inline-flex items-center justify-center rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-black hover:bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save URL"}
              </button>
            </div>
          </form>

          <Dialog.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground text-white">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
