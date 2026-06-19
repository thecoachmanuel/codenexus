// WorkspaceClient.tsx
"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { ChatPanel } from "./ChatPanel";
import { CodePanel } from "./CodePanel";
import { MobileBlocker } from "./MobileBlocker";
import { GitHubImportModal } from "./GitHubImportModal";
import { MIN_CREDITS_TO_GENERATE } from "@/lib/constants";
import { toast } from "sonner";
import { GitBranch } from "lucide-react";
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
  const [messages, setMessages] = useState<Message[]>(
    parseMessages(workspace?.messages)
  );
  const [fileData, setFileData] = useState<FileData | null>(
    parseFileData(workspace?.fileData)
  );
  const [credits, setCredits] = useState(userCredits);
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusLog, setStatusLog] = useState<StatusStep[]>([]);
  
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
    async (prompt: string, imageUrl?: string) => {
      if (isGenerating) return;
      if (credits < MIN_CREDITS_TO_GENERATE) return;

      const userMessage: Message = {
        role: "user",
        content: prompt,
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
        // Strip massive fileDataSnapshots before sending to prevent 413 Payload Too Large errors
        const payloadMessages = conversationHistory.map(({ fileDataSnapshot, ...rest }) => rest);

        // Strip file *code* from fileData — server embeds it into the last message context.
        // We only send metadata (deps, envVars, title, file paths) to keep payload tiny.
        const currentFD = fileDataRef.current;
        const payloadFileData = currentFD
          ? {
              dependencies: currentFD.dependencies,
              envVars: currentFD.envVars,
              title: currentFD.title,
              suggestions: currentFD.suggestions,
              // File paths only, no code
              filePaths: Object.keys(currentFD.files ?? {}),
            }
          : null;

        const res = await fetch("/api/gen-ai-code", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: abortController.signal,
          body: JSON.stringify({
            workspaceId: currentWorkspaceId,
            userId,
            messages: payloadMessages,
            fileData: payloadFileData,
          }),
        });

        if (res.status === 402) {
          const data = await res.json().catch(() => ({}));
          toast.error(data.message || "Insufficient credits.");
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
                throw new Error(event.message);
              }
            } catch {
              // skip malformed SSE lines
            }
          }
        }
      } catch (err) {
        // User-initiated stop — silently roll back the user message
        if (err instanceof Error && err.name === "AbortError") {
          setMessages((prev) => prev.slice(0, -1));
          return;
        }
        console.error(err);
        toast.error(
          err instanceof Error ? err.message : "Something went wrong."
        );
        setMessages((prev) => prev.slice(0, -1));
      } finally {
        generateAbortRef.current = null;
        setIsGenerating(false);
        setStatusLog([]);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [credits, isGenerating, userId]
    // fileData intentionally omitted — read via fileDataRef
  );

  const handleUndoMessage = useCallback(async (index: number) => {
    if (!workspaceIdRef.current) return;
    
    const loadingToast = toast.loading("Undoing changes...");
    try {
      const res = await fetch(`/api/workspace/${workspaceIdRef.current}/undo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to undo");
      
      setMessages(data.messages);
      setFileData(data.fileData);
      setFileHistory([]);
      toast.success("Successfully reverted to previous state.", { id: loadingToast });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to undo", { id: loadingToast });
    }
  }, []);

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

  // Handle GitHub repo import

  const handleGitHubImport = useCallback((imported: FileData, repoName: string) => {
    setFileData(imported);
    setMessages((prev) => [
      ...prev,
      {
        role: "assistant" as const,
        content: `✅ Successfully imported **${repoName}** from GitHub.\n\n${Object.keys(imported.files ?? {}).length} files loaded into your workspace. You can now ask me to modify, refactor, add features, or explain any part of the code.`,
      },
    ]);
    toast.success(`Imported ${repoName} — ${Object.keys(imported.files ?? {}).length} files loaded.`);
  }, []);

  return (
    <>
      {/* Mobile blocker — visible only on small screens */}
      <div className="md:hidden">
        <MobileBlocker />
      </div>

      {/* Workspace — visible only on md+ screens */}
      <div className="hidden md:flex h-[calc(100vh-3.5rem)] overflow-hidden bg-[#0a0a0a]">
        <ChatPanel
          isImproving={false}
          messages={messages}
          isGenerating={isGenerating}
          statusLog={statusLog}
          credits={credits}
          initialPrompt={initialPrompt}
          initialImageUrl={resolvedImageUrl}
          suggestions={fileData?.suggestions}
          onGenerate={handleGenerate}
          onStop={handleStop}
          onRevert={handleRevert}
          canRevert={fileHistory.length > 0}
          onUndoMessage={handleUndoMessage}
          userId={userId}
          workspaceId={workspaceId}
          appTitle={fileData?.title ?? workspace?.title ?? null}
          githubImportButton={
            <GitHubImportModal
              isProUser={userPlan === "pro"}
              onImport={handleGitHubImport}
            >
              <button
                title="Import from GitHub"
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/20 bg-white/5 text-white/60 hover:border-white/40 hover:bg-white/10 hover:text-white transition-all"
              >
                <GitBranch className="h-3.5 w-3.5" />
              </button>
            </GitHubImportModal>
          }
        />
        <div className="w-px shrink-0 bg-white/6" />
        <CodePanel
          key={workspaceId || "new"}
          fileData={fileData}
          isGenerating={isGenerating}
          statusLog={statusLog}
          onImprove={handleGenerate}
          onFixError={(error) =>
            handleGenerate(
              `There is an error in the preview:\n\n\`\`\`\n${error}\n\`\`\`\n\nPlease fix it.`
            )
          }
          onFilePatch={handleFilePatch}
          appTitle={fileData?.title ?? workspace?.title ?? null}
          isImproving={false}
          isProUser={userPlan === "pro"}
          onEnvVarsChange={handleEnvVarsChange}
        />
      </div>
    </>
  );
}
