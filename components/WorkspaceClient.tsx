// WorkspaceClient.tsx
"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { MessageSquare } from "lucide-react";
import { ChatPanel } from "./ChatPanel";
import { CodePanel } from "./CodePanel";
import { MobileBlocker } from "./MobileBlocker";
import { MIN_CREDITS_TO_GENERATE } from "@/lib/constants";
import { toast } from "sonner";

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
  const [isMobileChatOpen, setIsMobileChatOpen] = useState(false);
  
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

  // Read GitHub import from sessionStorage (set by the projects page)
  useEffect(() => {
    if (workspace) return; // Don't override an existing workspace
    try {
      const raw = sessionStorage.getItem("github_import");
      if (!raw) return;
      sessionStorage.removeItem("github_import");
      const { fileData: imported, repoName } = JSON.parse(raw) as {
        fileData: FileData;
        repoName: string;
      };
      setFileData(imported);
      setMessages([
        {
          role: "assistant",
          content: `✅ Successfully imported **${repoName}** from GitHub.\n\n${Object.keys(imported.files ?? {}).length} files loaded into your workspace. You can now ask me to modify, refactor, add features, or explain any part of the code.`,
        },
      ]);
    } catch {
      // ignore
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
        if (!res.ok || !res.body) throw new Error("Generation failed");

        const reader = res.body.getReader();
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
                
                setFileData(event.fileData);
                setCredits(event.creditsRemaining);
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
        
        {/* Mobile Backdrop overlay */}
        {isMobileChatOpen && (
          <div 
            className="md:hidden absolute inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300"
            onClick={() => setIsMobileChatOpen(false)}
          />
        )}

        {/* ChatPanel Container */}
        <div 
          className={`
            md:relative md:flex md:h-full md:shrink-0 md:translate-y-0
            ${isMobileChatOpen 
              ? 'absolute inset-x-0 bottom-0 z-50 h-[85vh] rounded-t-3xl shadow-2xl transition-transform duration-300 translate-y-0' 
              : 'absolute inset-x-0 bottom-0 z-50 h-[85vh] transition-transform duration-300 translate-y-full md:translate-y-0'
            }
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
              // Automatically collapse sheet when generating on mobile
              setIsMobileChatOpen(false);
              setFixRetryCount(0); // Reset compile error retries on explicit user prompt
              await handleGenerate(prompt, imageUrl);
            }}
            onStop={handleStop}
            onRevert={handleRevert}
            canRevert={fileHistory.length > 0}
            userId={userId}
            workspaceId={workspaceId}
            appTitle={fileData?.title ?? workspace?.title ?? null}
            onCloseMobile={() => setIsMobileChatOpen(false)}
          />
        </div>

        {/* Desktop Divider */}
        <div className="hidden md:block w-px shrink-0 bg-white/6" />

        {/* CodePanel Container */}
        <div className="flex-1 min-w-0 h-full relative">
          <CodePanel
            key={workspaceId || "new"}
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
          
          {/* Mobile Floating Action Button */}
          <button 
            onClick={() => setIsMobileChatOpen(true)}
            className={`
              md:hidden absolute bottom-6 right-6 z-40 
              flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg shadow-blue-500/20
              transition-transform duration-300
              ${isMobileChatOpen ? 'scale-0' : 'scale-100'}
            `}
          >
            <MessageSquare className="h-6 w-6" />
          </button>
        </div>
      </div>
    </>
  );
}
