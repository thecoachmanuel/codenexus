"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useAuthContext } from "@/components/AuthProvider";
import {
  ArrowUp,
  Paperclip,
  Loader2,
  X,
  Sparkles,
  Wand2,
  Square,
  Undo2,
  ChevronRight,
  Copy,
  RotateCcw
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { PricingModal } from "@/components/PricingModal";
import type { Message, StatusStep } from "@/types/workspace";
import { BlueTitle } from "./reusables";
import Image from "next/image";

interface ChatPanelProps {
  messages: Message[];
  isGenerating: boolean;
  isImproving: boolean;
  statusLog: StatusStep[];
  credits: number;
  initialPrompt: string | null;
  initialImageUrl: string | null | undefined;
  onGenerate: (prompt: string, imageUrl?: string) => Promise<void>;
  onStop: () => void;
  userId: string;
  workspaceId: string | null;
  appTitle: string | null;
  githubImportButton?: React.ReactNode;
  suggestions?: string[];
  onRevert?: () => void;
  canRevert?: boolean;
  onUndoMessage?: (index: number) => void;
}

export function ChatPanel({
  messages,
  isGenerating,
  isImproving,
  statusLog,
  credits,
  initialPrompt,
  initialImageUrl,
  onGenerate,
  onStop,
  userId,
  workspaceId,
  appTitle,
  githubImportButton,
  suggestions,
  onRevert,
  canRevert,
  onUndoMessage,
}: ChatPanelProps) {
  const { user } = useAuthContext();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const handleCopy = (content: string) => {
    navigator.clipboard.writeText(content);
    toast.success("Message copied to clipboard!");
  };
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [input, setInput] = useState("");
  const [pendingImageUrl, setPendingImageUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const hasAutoSubmittedRef = useRef(false);
  const noCredits = credits <= 0;

  // The last message is the live-streaming assistant placeholder during improve
  const lastMsg = messages[messages.length - 1];
  const isStreamingAssistant = isImproving && lastMsg?.role === "assistant";

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [input]);

  // Auto-scroll on new messages or streaming updates
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, isGenerating, isImproving]);

  useEffect(() => {
    // undefined = image not yet resolved from sessionStorage, skip until it's ready
    if (initialImageUrl === undefined) return;
    // Fires once when initialImageUrl resolves to null (no image) or a data URL
    if (!initialPrompt || hasAutoSubmittedRef.current || messages.length > 0)
      return;
    hasAutoSubmittedRef.current = true;
    onGenerate(initialPrompt, initialImageUrl ?? undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialImageUrl]);

  const handleSubmit = async () => {
    const trimmed = input.trim();
    if (!trimmed || isGenerating || isImproving || noCredits) return;
    setInput("");
    setPendingImageUrl(null);
    await onGenerate(trimmed, pendingImageUrl ?? undefined);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      setPendingImageUrl(data.url);
    } catch {
      // silent
    } finally {
      setIsUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const canSubmit =
    input.trim().length > 0 && !isGenerating && !isImproving && !noCredits;

  return (
    <div className="flex w-[320px] shrink-0 flex-col bg-[#0d0d0d]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/6 px-2 py-3">
        <BlueTitle>{appTitle}</BlueTitle>
        <div className="flex items-center gap-1.5">
          {canRevert && onRevert && (
            <button
              onClick={onRevert}
              title="Revert last change"
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/20 bg-white/5 text-white/60 hover:border-white/40 hover:bg-white/10 hover:text-white transition-all"
            >
              <Undo2 className="h-3.5 w-3.5" />
            </button>
          )}
          {githubImportButton}
          <PricingModal reason={noCredits ? "credits" : "upgrade"}>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] transition-colors",
                noCredits
                  ? "bg-red-500/15 text-red-400/80 hover:bg-red-500/25"
                  : "bg-white/6 text-white/60 hover:bg-white/10 hover:text-white/50"
              )}
            >
              {noCredits
                ? "No credits · Upgrade"
                : `${credits} credit${credits !== 1 ? "s" : ""}`}
            </span>
          </PricingModal>
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto px-3 py-4 [&::-webkit-scrollbar]:hidden"
      >
        {messages.length === 0 && !isGenerating && (
          <div className="flex h-full items-center justify-center">
            <p className="text-center text-sm text-white/40">
              Describe what you want to build…
            </p>
          </div>
        )}

        <div className="space-y-4">
          {messages.map((msg, i) => {
            const isLast = i === messages.length - 1;
            // This is the live-streaming assistant bubble during improve
            const isLiveStream = isLast && isStreamingAssistant;

            return (
              <div key={i} className="group relative">
                {/* Floating Action Bar */}
                <div className="absolute right-0 top-0 -translate-y-1/2 opacity-0 flex items-center gap-1 bg-[#111111] border border-white/10 rounded-lg p-1 shadow-xl transition-all duration-200 group-hover:opacity-100 group-hover:translate-y-0 z-10">
                  <button
                    onClick={() => handleCopy(msg.content)}
                    className="p-1.5 text-white/40 hover:text-white hover:bg-white/10 rounded-md transition-colors"
                    title="Copy message"
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                  {onUndoMessage && workspaceId && (
                    <button
                      onClick={() => onUndoMessage(i)}
                      className="p-1.5 text-white/40 hover:text-red-400 hover:bg-red-400/10 rounded-md transition-colors"
                      title="Revert project to this point"
                    >
                      <RotateCcw className="h-3 w-3" />
                    </button>
                  )}
                </div>

                {msg.role === "user" ? (
                  <div className="flex items-start justify-end gap-2">
                    <div className="max-w-[85%] space-y-1.5">
                      {msg.imageUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={msg.imageUrl}
                          alt="uploaded"
                          className="max-h-40 w-full rounded-lg object-cover"
                        />
                      )}
                      <div className="rounded-2xl rounded-br-sm bg-white/10 px-3.5 py-2.5">
                        <p className="text-[13px] leading-relaxed text-white wrap-break-word">
                          {msg.content}
                        </p>
                      </div>
                    </div>
                    {user?.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={user.imageUrl}
                        alt={user.name ?? "You"}
                        className="mt-0.5 h-6 w-6 shrink-0 rounded-full"
                      />
                    ) : (
                      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-400 to-purple-500 text-[10px] font-semibold text-white">
                        {user?.name?.[0]?.toUpperCase() ?? "U"}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex items-start gap-2">
                    <Image
                      src="/logo-short.jpeg"
                      alt="Crevo"
                      width={24}
                      height={24}
                      className="mt-0.5 h-6 w-6 shrink-0 rounded-md"
                    />
                    <div className="min-w-0 rounded-2xl rounded-tl-sm bg-white/5 px-3.5 py-2.5">
                      {isLiveStream && !msg.content ? (
                        // Empty placeholder — show Cline thinking indicator
                        <div className="flex items-center gap-2">
                          <Wand2 className="h-3 w-3 shrink-0 text-blue-400/60 animate-pulse" />
                          <span className="text-[12px] text-white/60 animate-pulse">
                            Cline is thinking…
                          </span>
                        </div>
                      ) : isLiveStream && msg.content ? (
                        // Streaming thinking text — show raw (not markdown)
                        // with a blinking cursor at the end
                        <div>
                          <div className="mb-1.5 flex items-center gap-1.5">
                            <Wand2 className="h-3 w-3 shrink-0 text-blue-400/60" />
                            <span className="text-[10px] font-medium uppercase tracking-wider text-blue-400/50">
                              Agent reasoning
                            </span>
                          </div>
                          <p className="text-[12px] leading-relaxed text-white/35 wrap-break-word">
                            {msg.content}
                            <span className="ml-0.5 inline-block h-3 w-0.5 animate-[blink_1s_ease-in-out_infinite] bg-blue-400/60 align-middle" />
                          </p>
                        </div>
                      ) : (
                        // Normal completed assistant message
                        <div className="prose prose-sm prose-invert max-w-none wrap-break-word text-[13px] leading-relaxed text-white [&_code]:rounded [&_code]:bg-white/10 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-blue-300/80 [&_code]:text-xs [&_code]:break-all [&_li]:my-0.5 [&_p]:my-1 [&_pre]:overflow-x-auto! [&_pre]:whitespace-pre-wrap! [&_ul]:my-1">
                          <ReactMarkdown>{msg.content}</ReactMarkdown>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                
                {/* Render suggestions below the VERY LAST assistant message when idle */}
                {isLast && msg.role === "assistant" && !isGenerating && !isImproving && suggestions && suggestions.length > 0 && (
                  <div className="mt-5 flex flex-col gap-3 pl-8 pr-2">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <Sparkles className="h-3 w-3 text-blue-400/80" />
                      <p className="text-[11px] font-medium uppercase tracking-wider text-blue-400/80">Suggested Improvements</p>
                    </div>
                    {suggestions.map((suggestion, idx) => (
                      <button
                        key={idx}
                        onClick={() => onGenerate(suggestion)}
                        className="group relative flex w-full flex-col items-start justify-between rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 text-left transition-all hover:border-blue-500/30 hover:bg-blue-500/5 hover:shadow-lg hover:shadow-blue-500/5"
                      >
                        <span className="text-[13px] leading-relaxed text-white/90 group-hover:text-white mb-3">{suggestion}</span>
                        <div className="flex w-full items-center justify-between">
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-white/30 group-hover:text-blue-400/70 transition-colors">Apply</span>
                          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-white/5 transition-colors group-hover:bg-blue-500/20">
                            <ChevronRight className="h-3 w-3 text-white/40 group-hover:text-blue-400" />
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Live status steps — only shown during normal generation */}
          {isGenerating && (
            <div className="flex items-start gap-2">
              <Image
                src="/logo-short.jpeg"
                alt="Crevo"
                width={24}
                height={24}
                className="mt-0.5 h-6 w-6 shrink-0 rounded-md"
              />
              <div className="rounded-2xl rounded-tl-sm bg-white/5 px-3.5 py-3">
                <div className="space-y-2">
                  {statusLog.map((step, i) => (
                    <div key={i} className="flex items-center gap-2.5">
                      <div className="flex h-4 w-4 shrink-0 items-center justify-center">
                        {step.status === "running" ? (
                          <Loader2 className="h-3 w-3 animate-spin text-blue-400/80" />
                        ) : (
                          <svg
                            className="h-3 w-3 text-white/25"
                            viewBox="0 0 12 12"
                            fill="none"
                          >
                            <path
                              d="M2 6l3 3 5-5"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        )}
                      </div>
                      <span
                        className={cn(
                          "text-[12px] transition-colors duration-300",
                          step.status === "running"
                            ? "text-white/75"
                            : "text-white/25"
                        )}
                      >
                        {step.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* No-credits upgrade banner */}
      {noCredits && (
        <div className="mx-3 mb-2 rounded-xl border border-red-500/15 bg-red-950/40 px-4 py-3">
          <p className="mb-2 text-[12px] font-medium text-red-400/80">
            You&apos;ve used all your credits
          </p>
          <PricingModal reason="credits">
            <span className="inline-flex h-8 items-center gap-1.5 rounded-full text-sm active:scale-95 cursor-pointer bg-white text-black px-3">
              <Sparkles className="h-3 w-3" />
              Upgrade plan
            </span>
          </PricingModal>
        </div>
      )}

      {/* Input */}
      <div className="border-t border-white/6 p-3">
        {pendingImageUrl && (
          <div className="relative mb-2 w-fit">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={pendingImageUrl}
              alt="pending upload"
              className="h-16 w-16 rounded-lg object-cover"
            />
            <button
              onClick={() => setPendingImageUrl(null)}
              className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/80 text-white/90 hover:text-white"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </div>
        )}

        <div
          className={cn(
            "rounded-xl border bg-white/4 transition-colors",
            isGenerating || isImproving
              ? "border-white/4"
              : noCredits
              ? "border-white/4 opacity-60"
              : "border-white/20 hover:border-white/12"
          )}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isGenerating || isImproving || noCredits}
            placeholder={
              noCredits
                ? "Upgrade to keep building…"
                : isImproving
                ? "Cline is improving your app…"
                : isGenerating
                ? "Generating…"
                : "Ask AI to modify…"
            }
            rows={1}
            className="w-full resize-none bg-transparent px-3.5 pb-2 pt-3 text-[13px] text-white placeholder:text-white/20 focus:outline-none"
            style={{ maxHeight: 160 }}
          />

          <div className="flex items-center justify-between px-2 pb-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => fileRef.current?.click()}
              disabled={isGenerating || isImproving || isUploading || noCredits}
              className="h-7 w-7 rounded-lg text-white/25 hover:bg-white/6 hover:text-white/50 disabled:opacity-40"
            >
              {isUploading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Paperclip className="h-3.5 w-3.5" />
              )}
            </Button>

            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
            />

            {/* Stop button — shown while generating or improving */}
            {isGenerating || isImproving ? (
              <Button
                size="icon"
                onClick={onStop}
                className="h-7 w-7 rounded-lg bg-white/10 text-white/90 hover:bg-white/20 hover:text-white active:scale-95 transition-all"
              >
                <Square className="h-3 w-3 fill-current" />
              </Button>
            ) : (
              <Button
                size="icon"
                onClick={handleSubmit}
                disabled={!canSubmit}
                className={cn(
                  "h-7 w-7 rounded-lg transition-all",
                  canSubmit
                    ? "bg-white text-black hover:bg-white/90 active:scale-95"
                    : "bg-white/8 text-white/40 shadow-none"
                )}
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        <p className="mt-1.5 text-center text-[10px] text-white/15">
          {isGenerating || isImproving
            ? "Click ■ to stop generation"
            : "⏎ to send · Shift+⏎ for new line"}
        </p>
      </div>
    </div>
  );
}
