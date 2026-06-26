// WorkspaceClient.tsx
"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { MessageSquare, Bot } from "lucide-react";
import { ChatPanel } from "./ChatPanel";
import { CodePanel } from "./CodePanel";
import { MobileBlocker } from "./MobileBlocker";
import { MIN_CREDITS_TO_GENERATE } from "@/lib/constants";
import { toast } from "sonner";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useAuthContext } from "@/components/AuthProvider";
import { PricingModal } from "@/components/PricingModal";

import type {
  Message,
  FileData,
  StatusStep,
  WorkspaceData,
} from "@/types/workspace";

export type {
  MessageRole,
  Message,
  FileData,
  StatusStep,
} from "@/types/workspace";

interface WorkspaceClientProps {
  initialPrompt: string | null;
  initialImageUrl: string | null;
  workspace: WorkspaceData | null;
  userCredits: number;
  userId: string;
  userPlan: string;
}

function parseMessages(raw: unknown): Message[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (m): m is Message =>
      typeof m === "object" && m !== null && "role" in m && "content" in m
  );
}

function parseFileData(raw: unknown): FileData | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Record<string, unknown>;
  if (!f.files || !f.dependencies) return null;
  return raw as FileData;
}

export function WorkspaceClient({
  initialPrompt,
  initialImageUrl,
  workspace,
  userCredits,
  userId,
  userPlan,
}: WorkspaceClientProps) {
  const { updateUserCredits } = useAuthContext();
  const [workspaceId, setWorkspaceId] = useState<string | null>(
    workspace?.id ?? null
  );
  const [subdomain, setSubdomain] = useState<string | null>(
    workspace?.subdomain ?? null
  );
  const [messages, setMessages] = useState<Message[]>(
    parseMessages(workspace?.messages)
  );
  const [fileData, setFileData] = useState<FileData | null>(
    parseFileData(workspace?.fileData)
  );
  const [credits, setCredits] = useState(userCredits);
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusLog, setStatusLog] = useState<StatusStep[]>([]);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<"chat" | "preview">("chat");
  // Undo / Revert History Stack
  const [fileHistory, setFileHistory] = useState<FileData[]>([]);

  // Resolve image uploaded from the homepage (stored in sessionStorage to avoid huge query params).
  // undefined = not yet resolved, null = no image, string = image data URL
  const [resolvedImageUrl, setResolvedImageUrl] = useState<string | null | undefined>(
    initialImageUrl === "__from_session__" ? undefined : initialImageUrl
  );
  useEffect(() => {
    if (initialImageUrl !== "__from_session__") return; // already set in initial state
    try {
      const img = sessionStorage.getItem("initial_image");
      sessionStorage.removeItem("initial_image");
      setResolvedImageUrl(img ?? null);
    } catch {
      setResolvedImageUrl(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // AbortController refs — used to cancel in-flight streams
  const generateAbortRef = useRef<AbortController | null>(null);
  const improveAbortRef = useRef<AbortController | null>(null);

  // Refs to avoid stale closures in callbacks
  const messagesRef = useRef<Message[]>(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const workspaceIdRef = useRef<string | null>(workspaceId);
  useEffect(() => {
    workspaceIdRef.current = workspaceId;
  }, [workspaceId]);

  // fileData ref — so handleImprove never closes over stale fileData
  // even as file_patch events stream in
  const fileDataRef = useRef<FileData | null>(fileData);
  useEffect(() => {
    fileDataRef.current = fileData;
  }, [fileData]);

  const [fixRetryCount, setFixRetryCount] = useState(0);

  const pushStep = (label: string) => {
    setStatusLog((prev) => [
      ...prev.map((s, i) =>
        i === prev.length - 1 ? { ...s, status: "done" as const } : s
      ),
      { label, status: "running" as const },
    ]);
  };

  const completeSteps = () => {
    setStatusLog((prev) =>
      prev.map((s, i) =>
        i === prev.length - 1 ? { ...s, status: "done" as const } : s
      )
    );
  };

  const handleGenerate = useCallback(
    async (prompt: string, imageUrl?: string, retryCount: number = 0) => {
      if (isGenerating) return;
      if (credits < MIN_CREDITS_TO_GENERATE) return;

      const augmentedPrompt = previewError 
        ? `${prompt}\n\n[System Context: The preview is currently crashing. Please fix this exact error:\n${previewError}]` 
        : prompt;

      const userMessage: Message = {
        role: "user",
        content: augmentedPrompt,
        ...(imageUrl ? { imageUrl } : {}),
      };

      const currentMessages = messagesRef.current;
      const currentWorkspaceId = workspaceIdRef.current;

      setMessages((prev) => [...prev, userMessage]);
      setIsGenerating(true);
      setStatusLog([{ label: "Thinking…", status: "running" }]);

      // Create a fresh AbortController for this request
      const abortController = new AbortController();
      generateAbortRef.current = abortController;

      try {
        const conversationHistory = [...currentMessages, userMessage];

        const res = await fetch("/api/gen-ai-code", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: abortController.signal,
          body: JSON.stringify({
            workspaceId: currentWorkspaceId,
            userId,
            messages: conversationHistory,
            fileData: fileDataRef.current,
            retryCount, // Pass retryCount to backend for Bounded Repair Loop
          }),
        });

        if (res.status === 402) {
          setMessages((prev) => prev.slice(0, -1));
          return;
        }
        if (res.status === 429) {
          toast.error("Too many requests. Please slow down.");
          setMessages((prev) => prev.slice(0, -1));
          return;
        }
        if (!res.ok) throw new Error("Generation failed");

        let streamRes = res;
        const contentType = res.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
           const json = await res.json();
           if (json.isAsync && json.workspaceId) {
             setWorkspaceId(json.workspaceId);
             window.history.replaceState(null, "", `/workspace?id=${json.workspaceId}`);
             
             // Connect to the Change Stream SSE endpoint
             streamRes = await fetch(`/api/workspace/${json.workspaceId}/stream`, {
               signal: abortController.signal
             });
           }
        }

        if (!streamRes.body) throw new Error("No stream body");
        const reader = streamRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const event = JSON.parse(line.slice(6));
              if (event.type === "status") {
                pushStep(event.message);
              } else if (event.type === "done") {
                completeSteps();
                setWorkspaceId(event.workspaceId);
                if (event.subdomain) setSubdomain(event.subdomain);
                
                // Snapshot the current file state before applying new one
                if (fileDataRef.current) {
                  const currentSnapshot = JSON.parse(JSON.stringify(fileDataRef.current));
                  setFileHistory((prev) => [...prev, currentSnapshot]);
                }
                
                if (event.fileData) {
                  setFileData((prev: any) => ({
                    ...prev,
                    ...event.fileData,
                    files: Object.keys(event.fileData.files || {}).length > 0 
                      ? event.fileData.files 
                      : prev?.files,
                  }));
                }
                setCredits(event.creditsRemaining);
                updateUserCredits(event.creditsRemaining);
                setMessages((prev) => [
                  ...prev,
                  { role: "assistant", content: event.assistantMessage },
                ]);
                window.history.replaceState(
                  null,
                  "",
                  `/workspace?id=${event.workspaceId}`
                );
              } else if (event.type === "error") {
                toast.error(event.message || "Generation failed");
                pushStep(event.message || "Generation failed");
                setIsGenerating(false);
              } else if (event.type === "thinking") {
                pushStep(event.text);
              } else if (event.type === "file_patch") {
                setFileData((prev) => {
                  const existing = prev ?? {
                    title: "Untitled App",
                    files: {},
                    dependencies: {},
                  };
                  return {
                    ...existing,
                    files: {
                      ...existing.files,
                      [event.path]: { code: event.code },
                    },
                  };
                });
              } else if (event.type === "fileData_full") {
                if (event.fileData) {
                  setFileData((prev: any) => ({
                    ...prev,
                    ...event.fileData,
                    files: Object.keys(event.fileData.files || {}).length > 0 
                      ? event.fileData.files 
                      : prev?.files,
                  }));
                }
              } else if (event.type === "error") {
                throw new Error(event.message);
              }
            } catch (err) {
              // Re-throw if it's the error we just manually threw
              if (err instanceof Error && err.message !== "Unexpected end of JSON input" && !err.message.includes("JSON")) {
                throw err;
              }
              // otherwise skip malformed SSE lines
            }
          }
        }
      } catch (err) {
        // User-initiated stop — silently roll back the user message
        if (err instanceof Error && err.name === "AbortError") {
          setMessages((prev) => prev.slice(0, -1));
          completeSteps();
          return;
        }
        console.error(err);
        toast.error(
          err instanceof Error ? err.message : "Something went wrong."
        );
        setMessages((prev) => prev.slice(0, -1));
        completeSteps();
      } finally {
        setIsGenerating(false);
        generateAbortRef.current = null;
        setStatusLog([]);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [credits, isGenerating, userId]
    // fileData intentionally omitted — read via fileDataRef
  );

  const handleRevert = useCallback(() => {
    setFileHistory((prev) => {
      if (prev.length === 0) return prev;
      const historyCopy = [...prev];
      const previousState = historyCopy.pop();
      if (previousState) {
        setFileData(previousState);
        // Silently drop the latest assistant message too
        setMessages((msgs) => {
          if (msgs.length > 0 && msgs[msgs.length - 1].role === "assistant") {
            return msgs.slice(0, -1);
          }
          return msgs;
        });
        toast.success("Reverted to previous state.");
      }
      return historyCopy;
    });
  }, []);

  // Cancel whichever stream is currently in-flight
  const handleStop = useCallback(() => {
    generateAbortRef.current?.abort();
  }, []);

  const handleFilePatch = useCallback((patches: FileData) => {
    setFileData(patches);
  }, []);

  const handleEnvVarsChange = useCallback((envVars: Record<string, string>) => {
    if (fileDataRef.current) {
      const currentSnapshot = JSON.parse(JSON.stringify(fileDataRef.current));
      setFileHistory((prev) => [...prev, currentSnapshot]);
    }
    setFileData((prev) => prev ? { ...prev, envVars } : { envVars });
    toast.success("Environment variables updated.");
  }, []);


  return (
    <>
      <div className="relative flex h-[calc(100vh-3.5rem)] w-full overflow-hidden bg-[#0a0a0a]">
        
        {/* Mobile Tab Control Pill & Upgrade */}
        <div className="md:hidden absolute top-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2">
          {/* Chat/Preview Toggle Pill */}
          <div className="bg-[#1a1a1a] border border-white/10 rounded-full p-1 flex items-center shadow-2xl backdrop-blur-md">
            <button 
              onClick={() => setMobileTab("chat")}
              className={`px-4 py-1.5 text-xs font-medium rounded-full transition-all duration-200 ${mobileTab === 'chat' ? 'bg-white/20 text-white shadow-sm' : 'text-white/50 hover:text-white/80'}`}
            >
              Chat
            </button>
            <button 
              onClick={() => setMobileTab("preview")}
              className={`px-4 py-1.5 text-xs font-medium rounded-full transition-all duration-200 ${mobileTab === 'preview' ? 'bg-white/20 text-white shadow-sm' : 'text-white/50 hover:text-white/80'}`}
            >
              Preview
            </button>
          </div>

          {/* Upgrade Button (Mobile) */}
          {userPlan !== "pro" && (
            <div className="bg-[#1a1a1a] border border-white/10 rounded-full p-1 flex items-center shadow-2xl backdrop-blur-md">
              <PricingModal reason="upgrade">
                <span className="group relative flex h-[28px] w-[28px] cursor-pointer items-center justify-center overflow-hidden rounded-full bg-gradient-to-r from-violet-500/10 via-fuchsia-500/10 to-cyan-500/10 transition-all duration-300 hover:from-violet-500/20 hover:via-fuchsia-500/20 hover:to-cyan-500/20 hover:shadow-[0_0_12px_rgba(139,92,246,0.3)]">
                  <span className="pointer-events-none absolute inset-0 -translate-x-full animate-[shimmer_2.5s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                  <Bot className="h-4 w-4 text-violet-400 transition-colors group-hover:text-violet-300" />
                </span>
              </PricingModal>
            </div>
          )}
        </div>

        {/* ChatPanel Container */}
        <div 
          className={`
            md:relative md:flex md:h-full md:shrink-0 md:w-[400px] lg:w-[450px]
            ${mobileTab === 'chat' ? 'flex flex-1 h-full w-full pt-16 md:pt-0' : 'hidden md:flex'}
          `}
        >
          <ChatPanel
            isImproving={false}
            messages={messages}
            isGenerating={isGenerating}
            statusLog={statusLog}
            credits={credits}
            initialPrompt={initialPrompt}
            initialImageUrl={resolvedImageUrl}
            suggestions={fileData?.suggestions}
            onGenerate={async (prompt, imageUrl) => {
              // Automatically switch to preview when generating on mobile
              setMobileTab("preview");
              setFixRetryCount(0); // Reset compile error retries on explicit user prompt
              await handleGenerate(prompt, imageUrl);
            }}
            onStop={handleStop}
            onRevert={handleRevert}
            canRevert={fileHistory.length > 0}
            userId={userId}
            workspaceId={workspaceId}
            appTitle={fileData?.title ?? workspace?.title ?? null}
            onCloseMobile={() => setMobileTab("preview")}
          />
        </div>

        {/* Desktop Divider */}
        <div className="hidden md:block w-px shrink-0 bg-white/6" />

        {/* CodePanel Container */}
        <div className={`
          flex-col flex-1 min-w-0 h-full relative overflow-hidden pt-16 md:pt-0
          ${mobileTab === 'preview' ? 'flex' : 'hidden md:flex'}
        `}>
          <ErrorBoundary>
            <CodePanel
              fileData={fileData}
              isGenerating={isGenerating}
              statusLog={statusLog}
              onImprove={handleGenerate}
              onFixError={async (error) => {
                const newCount = fixRetryCount + 1;
                setFixRetryCount(newCount);
                await handleGenerate(
                  `[COMPILER ERROR]\nThere is an error in the preview:\n\n\`\`\`\n${error}\n\`\`\`\n\nPlease fix it.`,
                  undefined,
                  newCount
                );
              }}
              onFilePatch={handleFilePatch}
              appTitle={fileData?.title ?? workspace?.title ?? null}
              subdomain={subdomain}
              isImproving={false}
              isProUser={userPlan === "pro"}
              onEnvVarsChange={handleEnvVarsChange}
              vercelInfo={workspace?.vercel}
              workspaceId={workspaceId}
              previewError={previewError}
              setPreviewError={setPreviewError}
            />
          </ErrorBoundary>
        </div>
      </div>
    </>
  );
}
