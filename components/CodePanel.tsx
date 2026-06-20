// CodePanel.tsx
/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import {
  SandpackProvider,
  SandpackLayout,
  SandpackCodeEditor,
  SandpackPreview,
  SandpackFileExplorer,
  useSandpack,
} from "@codesandbox/sandpack-react";
import { dracula } from "@codesandbox/sandpack-themes";
import {
  Eye,
  Code2,
  Download,
  AlertTriangle,
  Bot,
  Loader2,
  ArrowUp,
  Monitor,
  Tablet,
  Smartphone,
  Maximize2,
  Minimize2,
  Settings2,
  Trash2,
  Plus,
  Rocket,
} from "lucide-react";
import { RingLoader } from "react-spinners";
import JSZip from "jszip";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PricingModal } from "@/components/PricingModal";
import { GitHubExportModal } from "@/components/GitHubExportModal";
import { VercelDeployModal } from "@/components/VercelDeployModal";
import type { FileData, StatusStep, VercelInfo } from "@/types/workspace";

// ─── Placeholder ──────────────────────────────────────────────────────────────

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

import { VITE_REACT_BOILERPLATE, BASE_DEPENDENCIES } from "@/lib/constants";

const PLACEHOLDER_FILES = {
  ...VITE_REACT_BOILERPLATE,
};

// Base dependencies are imported from constants.ts

// ─── Types ────────────────────────────────────────────────────────────────────

type ActiveTab = "preview" | "code" | "env";
type PreviewMode = "desktop" | "mobile" | "tablet";

interface CodePanelProps {
  fileData: FileData | null;
  isGenerating: boolean;
  statusLog: StatusStep[];
  onImprove: (userRequest: string) => Promise<void>;
  onFixError: (error: string) => Promise<void>;
  onFilePatch: (patches: FileData) => void;
  appTitle: string | null;
  isImproving: boolean;
  isProUser: boolean;
  onEnvVarsChange?: (envVars: Record<string, string>) => void;
  subdomain?: string | null;
  vercelInfo?: VercelInfo;
  workspaceId?: string | null;
}

// ─── SandpackInner ────────────────────────────────────────────────────────────
// Lives inside SandpackProvider so it can call useSandpack().
// Receives fileData as a prop and uses updateFile() to push code changes
// into the live Sandpack instance without remounting the provider.

function SandpackInner({
  isGenerating,
  statusLog,
  activeTab,
  setActiveTab,
  onImprove,
  onFixError,
  fileData,
  appTitle,
  isImproving,
  isProUser,
  onEnvVarsChange,
  subdomain,
  processedFiles,
  vercelInfo,
  workspaceId,
}: {
  isGenerating: boolean;
  statusLog: StatusStep[];
  activeTab: ActiveTab;
  setActiveTab: (t: ActiveTab) => void;
  onImprove: (userRequest: string) => Promise<void>;
  onFixError: (error: string) => Promise<void>;
  fileData: FileData | null;
  appTitle: string | null;
  isImproving: boolean;
  isProUser: boolean;
  onEnvVarsChange?: (envVars: Record<string, string>) => void;
  subdomain?: string | null;
  processedFiles: Record<string, { code: string }>;
  vercelInfo?: VercelInfo;
  workspaceId?: string | null;
}) {
  const { sandpack, listen } = useSandpack();
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("desktop");
  const [isExporting, setIsExporting] = useState(false);
  const [improveInput, setImproveInput] = useState("");
  const [showImproveInput, setShowImproveInput] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (subdomain) {
      setLiveUrl(`${window.location.protocol}//${subdomain}.${window.location.host}`);
    } else {
      setLiveUrl(null);
    }
  }, [subdomain]);

  // Environment variables local state
  const [localEnvVars, setLocalEnvVars] = useState<Record<string, string>>(
    fileData?.envVars || {}
  );

  useEffect(() => {
    if (fileData?.envVars) {
      setLocalEnvVars(fileData.envVars);
    }
  }, [fileData?.envVars]);

  const handleAddEnvVar = () => {
    setLocalEnvVars({ ...localEnvVars, "": "" });
  };

  const handleUpdateEnvVarKey = (oldKey: string, newKey: string, value: string) => {
    const updated = { ...localEnvVars };
    delete updated[oldKey];
    updated[newKey] = value;
    setLocalEnvVars(updated);
  };

  const handleUpdateEnvVarValue = (key: string, value: string) => {
    setLocalEnvVars({ ...localEnvVars, [key]: value });
  };

  const handleDeleteEnvVar = (key: string) => {
    const updated = { ...localEnvVars };
    delete updated[key];
    setLocalEnvVars(updated);
  };

  const handleSaveEnvVars = () => {
    if (onEnvVarsChange) {
      // Remove any empty keys
      const cleanEnv = Object.fromEntries(
        Object.entries(localEnvVars).filter(([k]) => k.trim() !== "")
      );
      onEnvVarsChange(cleanEnv);
    }
  };

  // Push file content updates into Sandpack without remounting.
  // This runs whenever processedFiles changes (e.g. after improve completes).
  // SandpackProvider key only changes when the file path set changes,
  // so this is the safe way to update existing file contents.
  const prevFilesRef = useRef<Record<string, { code: string }>>(processedFiles);
  useEffect(() => {
    if (!processedFiles) return;
    const prev = prevFilesRef.current;
    let updated = false;
    for (const [path, { code }] of Object.entries(processedFiles)) {
      if (prev[path]?.code !== code) {
        sandpack.updateFile(path, code);
        updated = true;
      }
    }
    // Delete files that were removed
    for (const path of Object.keys(prev)) {
      if (!processedFiles[path]) {
        sandpack.deleteFile(path);
        updated = true;
      }
    }
    if (updated) {
      prevFilesRef.current = processedFiles;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processedFiles]);

  // Listen for Sandpack runtime errors
  useEffect(() => {
    unsubscribeRef.current = listen((msg) => {
      if (
        msg.type === "action" &&
        "action" in msg &&
        msg.action === "show-error"
      ) {
        const errMsg =
          "message" in msg && typeof msg.message === "string"
            ? msg.message
            : "An error occurred in the preview.";
        setPreviewError(errMsg);
        return;
      }
      if (msg.type === "compile") {
        const errMsg =
          "message" in msg && typeof msg.message === "string"
            ? msg.message
            : "Compile error in preview.";
        setPreviewError(errMsg);
        return;
      }
      if (msg.type === "success") {
        setPreviewError(null);
      }
    });
    return () => unsubscribeRef.current?.();
  }, [listen]);

  useEffect(() => {
    if (isGenerating) setPreviewError(null);
  }, [isGenerating]);

  const handleImproveSubmit = async () => {
    const trimmed = improveInput.trim();
    if (!trimmed || isImproving) return;
    setImproveInput("");
    setShowImproveInput(false);
    await onImprove(trimmed);
  };

  // ── Export to ZIP ──────────────────────────────────────────────────────────
  const handleExportZip = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const filesToZip =
        Object.keys(sandpack.files).length > 0
          ? sandpack.files
          : fileData?.files ?? {};

      const dependencies = {
        ...BASE_DEPENDENCIES,
        ...(fileData?.dependencies ?? {}),
      };

      const zip = new JSZip();

      const packageJson = {
        name: "crevo-app-frontend",
        version: "1.0.0",
        private: true,
        dependencies: {
          react: "^18.2.0",
          "react-dom": "^18.2.0",
          "react-scripts": "5.0.1",
          ...dependencies,
        },
        scripts: {
          start: "react-scripts start",
          build: "react-scripts build",
        },
        browserslist: {
          production: [">0.2%", "not dead", "not op_mini all"],
          development: ["last 1 chrome version"],
        },
      };
      zip.file(`package.json`, JSON.stringify(packageJson, null, 2));

      zip.file(
        `public/index.html`,
        `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Crevo App</title>
    <script src="https://cdn.tailwindcss.com"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`
      );

      for (const [filePath, fileObj] of Object.entries(filesToZip)) {
        if (filePath === "/README.md" || filePath === "/IMPLEMENTATION_PLAN.md") continue;
        const code =
          typeof fileObj === "object" && fileObj !== null && "code" in fileObj
            ? (fileObj as { code: string }).code
            : "";
        let relativePath = filePath.startsWith("/") ? filePath.slice(1) : filePath;
        if (relativePath.startsWith("src/")) {
          relativePath = relativePath.slice(4);
        }
        zip.file(`src/${relativePath}`, code);
      }

      zip.file(
        `src/index.js`,
        `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<React.StrictMode><App /></React.StrictMode>);`
      );

      // Root README.md resolution
      let readmeContent = "";
      if (fileData?.files?.["/README.md"]) {
        readmeContent = fileData.files["/README.md"].code;
      }

      if (readmeContent) {
        zip.file("README.md", readmeContent);
      } else {
        zip.file(
          "README.md",
          `# Crevo App\n\nGenerated with [Crevo](https://crevo.app).\n\n## Getting started\n\n\`\`\`bash\nnpm install\nnpm start\n\`\`\``
        );
      }

      // Root IMPLEMENTATION_PLAN.md resolution
      let implPlanContent = "";
      if (fileData?.files?.["/IMPLEMENTATION_PLAN.md"]) {
        implPlanContent = fileData.files["/IMPLEMENTATION_PLAN.md"].code;
      }
      if (implPlanContent) {
        zip.file("IMPLEMENTATION_PLAN.md", implPlanContent);
      }

      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const zipName = appTitle
        ? `${appTitle
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")}.zip`
        : "crevo-app.zip";
      a.download = zipName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export failed:", err);
    } finally {
      setIsExporting(false);
    }
  };

  const currentStepLabel =
    statusLog[statusLog.length - 1]?.label ?? "Generating…";

  return (
    <Tabs
      value={activeTab}
      onValueChange={(v) => setActiveTab(v as ActiveTab)}
      className="flex h-full flex-col gap-0"
    >
      {/* Tabs + Actions bar */}
      <div className="flex items-center justify-between border-b border-white/6 px-2">
        <TabsList
          variant="line"
          className="h-auto gap-0 rounded-none bg-transparent p-0"
        >
          <TabsTrigger className="border-b-2 pt-2" value="code">
            <Code2 className="h-3.5 w-3.5" />
            Code
          </TabsTrigger>
          <TabsTrigger className="border-b-2 pt-2" value="preview">
            <Eye className="h-3.5 w-3.5" />
            Preview
          </TabsTrigger>
          <TabsTrigger className="border-b-2 pt-2" value="env">
            <Settings2 className="h-3.5 w-3.5" />
            Env
          </TabsTrigger>
        </TabsList>

        <div className="flex items-center gap-1.5">
          {/* ── Improve button ── */}
          {isProUser ? (
            showImproveInput ? (
              <div className="flex items-center gap-1.5">
                <div className="relative flex items-center">
                  <Bot className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-violet-400" />
                  <input
                    autoFocus
                    value={improveInput}
                    onChange={(e) => setImproveInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleImproveSubmit();
                      if (e.key === "Escape") setShowImproveInput(false);
                    }}
                    placeholder="What should I improve?"
                    className="h-7 w-56 rounded-md border border-violet-500/30 bg-gradient-to-r from-violet-500/10 via-fuchsia-500/10 to-cyan-500/10 pl-8 pr-3 text-sm text-white placeholder:text-white/30 focus:border-violet-400/50 focus:outline-none focus:shadow-[0_0_10px_rgba(139,92,246,0.2)]"
                  />
                </div>
                <button
                  onClick={handleImproveSubmit}
                  disabled={!improveInput.trim() || isImproving}
                  className="group relative flex h-7 w-7 items-center justify-center overflow-hidden rounded-md border border-violet-500/30 bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 text-violet-300 transition-all duration-200 hover:border-violet-400/50 hover:from-violet-500/30 hover:to-fuchsia-500/30 hover:shadow-[0_0_10px_rgba(139,92,246,0.3)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isImproving ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <ArrowUp className="h-3 w-3" />
                  )}
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowImproveInput(true)}
                disabled={isImproving || !fileData}
                className="group relative flex h-7 cursor-pointer items-center gap-1.5 overflow-hidden rounded-md border border-white/25 bg-gradient-to-r from-violet-500/10 via-fuchsia-500/10 to-cyan-500/10 px-2.5 text-sm font-medium transition-all duration-300 hover:border-white/20 hover:from-violet-500/20 hover:via-fuchsia-500/20 hover:to-cyan-500/20 hover:shadow-[0_0_12px_rgba(139,92,246,0.3)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span className="pointer-events-none absolute inset-0 -translate-x-full animate-[shimmer_2.5s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                {isImproving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-400" />
                ) : (
                  <Bot className="h-3.5 w-3.5 text-violet-400 transition-colors group-hover:text-violet-300" />
                )}
                <span className="bg-gradient-to-r from-violet-300 via-fuchsia-300 to-cyan-300 bg-clip-text text-transparent">
                  {isImproving ? "Improving…" : "Improve with Agent"}
                </span>
                {!isImproving && (
                  <span className="rounded-sm bg-violet-500/30 px-1 py-0.5 text-[10px] font-semibold leading-none text-violet-300">
                    PRO
                  </span>
                )}
              </button>
            )
          ) : (
            <PricingModal reason="upgrade">
              <span className="group relative flex h-7 cursor-pointer items-center gap-1.5 overflow-hidden rounded-md border border-white/25 bg-gradient-to-r from-violet-500/10 via-fuchsia-500/10 to-cyan-500/10 px-2.5 text-sm font-medium text-white/90 transition-all duration-300 hover:border-white/20 hover:from-violet-500/20 hover:via-fuchsia-500/20 hover:to-cyan-500/20 hover:text-white/90 hover:shadow-[0_0_12px_rgba(139,92,246,0.3)]">
                <span className="pointer-events-none absolute inset-0 -translate-x-full animate-[shimmer_2.5s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                <Bot className="h-3.5 w-3.5 text-violet-400 transition-colors group-hover:text-violet-300" />
                <span className="bg-gradient-to-r from-violet-300 via-fuchsia-300 to-cyan-300 bg-clip-text text-transparent">
                  Improve with Agent
                </span>
                <span className="rounded-sm bg-violet-500/30 px-1 py-0.5 text-[10px] font-semibold leading-none text-violet-300">
                  PRO
                </span>
              </span>
            </PricingModal>
          )}

          <VercelDeployModal
            fileData={fileData}
            appTitle={appTitle}
            vercelInfo={vercelInfo}
            workspaceId={workspaceId}
          >
            <Button
              variant="ghost"
              disabled={isExporting || !fileData}
              className="text-white/70 hover:text-white px-2"
              title="Deploy to Vercel"
            >
              <Rocket className="h-4 w-4" />
            </Button>
          </VercelDeployModal>

          {liveUrl && (
            <a
              href={liveUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 items-center justify-center rounded-md px-3 text-sm font-medium text-white/70 hover:bg-white/10 hover:text-white transition-colors"
              title="Open Live Site"
            >
              <Eye className="h-4 w-4 sm:mr-1.5" />
              <span className="hidden sm:inline">Live Site</span>
            </a>
          )}

          <GitHubExportModal
            fileData={fileData}
            appTitle={appTitle}
          >
            <Button
              variant="ghost"
              disabled={isExporting || !fileData}
              className="text-white/70 hover:text-white px-2"
              title="Export to GitHub"
            >
              <GithubIcon className="h-4 w-4" />
            </Button>
          </GitHubExportModal>

          <Button
            variant="ghost"
            onClick={handleExportZip}
            disabled={isExporting || !fileData}
          >
            {isExporting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
            ) : (
              <Download className="h-3.5 w-3.5 mr-1.5" />
            )}
            <span className="hidden sm:inline">Download</span>
            <span className="sm:hidden">ZIP</span>
          </Button>
        </div>
      </div>

      {/* Content area */}
      <div className="relative flex-1 overflow-hidden h-full">
        {(isGenerating || isImproving) && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-6 bg-[#0a0a0a]/85 backdrop-blur-sm">
            <RingLoader color="#60a5fa" size={64} speedMultiplier={0.8} />
            <div className="flex flex-col items-center gap-1.5">
              <p className="text-base font-medium text-white/90">
                {isImproving ? "Improving with Cline AI…" : currentStepLabel}
              </p>
              <p className="text-sm text-white/40">
                This usually takes 10–20 seconds
              </p>
            </div>
          </div>
        )}

        <SandpackLayout
          style={{
            height: "100vh",
            border: "none",
            borderRadius: 0,
            background: "transparent",
          }}
        >
          <TabsContent
            value="preview"
            keepMounted
            className={`mt-0 h-full w-full bg-[#0a0a0a] overflow-auto relative pb-16 ${
              isFullscreen ? "fixed inset-0 z-50 !pb-0" : ""
            }`}
          >
            {/* Viewport Toggles (only visible in preview tab) */}
            {activeTab === "preview" && (
              <div className="absolute top-4 right-4 z-10 flex items-center gap-1 rounded-lg border border-black/10 bg-white/50 p-1 backdrop-blur-md shadow-lg transition-opacity duration-200 opacity-60 hover:opacity-100">
                <button
                  onClick={() => setPreviewMode("mobile")}
                  className={`rounded-md p-1.5 transition-colors ${
                    previewMode === "mobile"
                      ? "bg-black/10 text-black shadow-sm"
                      : "text-gray-600 hover:bg-black/5 hover:text-black"
                  }`}
                  title="Mobile Preview"
                >
                  <Smartphone className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setPreviewMode("tablet")}
                  className={`rounded-md p-1.5 transition-colors ${
                    previewMode === "tablet"
                      ? "bg-black/10 text-black shadow-sm"
                      : "text-gray-600 hover:bg-black/5 hover:text-black"
                  }`}
                  title="Tablet Preview"
                >
                  <Tablet className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setPreviewMode("desktop")}
                  className={`rounded-md p-1.5 transition-colors ${
                    previewMode === "desktop"
                      ? "bg-black/10 text-black shadow-sm"
                      : "text-gray-600 hover:bg-black/5 hover:text-black"
                  }`}
                  title="Desktop Preview"
                >
                  <Monitor className="h-4 w-4" />
                </button>
                <div className="w-px h-4 bg-black/10 mx-1" />
                <button
                  onClick={() => setIsFullscreen(!isFullscreen)}
                  className="rounded-md p-1.5 text-gray-600 transition-colors hover:bg-black/5 hover:text-black"
                  title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
                >
                  {isFullscreen ? (
                    <Minimize2 className="h-4 w-4" />
                  ) : (
                    <Maximize2 className="h-4 w-4" />
                  )}
                </button>
              </div>
            )}

            <div
              className={`transition-all duration-500 ease-in-out mx-auto ${
                previewMode === "mobile"
                  ? "h-[812px] w-[375px] shrink-0 overflow-hidden rounded-[2.5rem] border-[8px] border-black ring-4 ring-white/10 shadow-2xl my-8"
                  : previewMode === "tablet"
                  ? "h-[1024px] w-[768px] shrink-0 overflow-hidden rounded-[2rem] border-[8px] border-black ring-4 ring-white/10 shadow-2xl my-8"
                  : isFullscreen ? "h-full w-full" : "h-full w-full"
              }`}
            >
              <SandpackPreview
                style={{ height: (previewMode === "desktop" && !isFullscreen) ? "89%" : "100%" }}
                showOpenInCodeSandbox={false}
              />
            </div>
          </TabsContent>

          <TabsContent
            value="code"
            keepMounted
            className="mt-0 flex h-full w-full"
          >
            <SandpackFileExplorer
              style={{
                height: "90%",
                width: "180px",
                borderRight: "0.5px solid rgba(255,255,255,0.08)",
              }}
            />
            <SandpackCodeEditor
              style={{ height: "90%", flex: 1 }}
              showTabs
              showLineNumbers
              showInlineErrors
              closableTabs
              readOnly
            />
          </TabsContent>

          <TabsContent
            value="env"
            keepMounted={false}
            className="mt-0 h-full w-full overflow-y-auto bg-[#0a0a0a] p-6 text-white"
          >
            <div className="mx-auto max-w-2xl space-y-6">
              <div>
                <h3 className="text-lg font-medium text-white/90">Environment Variables</h3>
                <p className="mt-1 text-sm text-white/50">
                  Configure variables like your MongoDB Atlas Data API keys here. These will be injected into <code>process.env</code> for the generated React app.
                </p>
              </div>

              <div className="space-y-3">
                {Object.entries(localEnvVars).map(([key, value], idx) => (
                  <div key={idx} className="flex items-center gap-3">
                    <input
                      type="text"
                      placeholder="KEY (e.g. REACT_APP_MONGODB_DATA_API_KEY)"
                      value={key}
                      onChange={(e) => handleUpdateEnvVarKey(key, e.target.value, value)}
                      className="w-1/2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/20 focus:border-violet-500 focus:outline-none"
                    />
                    <input
                      type="password"
                      placeholder="Value"
                      value={value}
                      onChange={(e) => handleUpdateEnvVarValue(key, e.target.value)}
                      className="w-1/2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/20 focus:border-violet-500 focus:outline-none"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDeleteEnvVar(key)}
                      className="h-9 w-9 text-red-400 hover:bg-red-500/20 hover:text-red-300"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-3 pt-2">
                <Button
                  onClick={handleAddEnvVar}
                  variant="outline"
                  className="border-white/20 bg-transparent text-white hover:bg-white/10"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add Variable
                </Button>
                <Button
                  onClick={handleSaveEnvVars}
                  className="bg-violet-600 text-white hover:bg-violet-700"
                >
                  Save & Reload
                </Button>
              </div>
            </div>
          </TabsContent>
        </SandpackLayout>
      </div>

      {/* Preview error banner — uses onFixError (Gemini), not onImprove (Cline) */}
      {previewError &&
        !isGenerating &&
        !isImproving &&
        activeTab === "preview" && (
          <div className="absolute inset-x-0 -bottom-3 z-20 border-t border-red-500/20 bg-red-950/99 p-4 pb-6">
            <div className="flex items-center gap-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400/70" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-red-400/80">
                  Preview error
                </p>
                <p className="break-all text-[11px] text-red-300/50">
                  {previewError}
                </p>
              </div>
              <Button
                onClick={() => onFixError(previewError)}
                variant="destructive"
              >
                <Bot className="h-3 w-3" />
                Fix with AI
              </Button>
            </div>
          </div>
        )}
    </Tabs>
  );
}

// ─── CodePanel (outer) ────────────────────────────────────────────────────────

export function CodePanel({
  fileData,
  isGenerating,
  statusLog,
  onImprove,
  onFixError,
  onFilePatch: _onFilePatch,
  appTitle,
  isImproving,
  isProUser,
  onEnvVarsChange,
  subdomain,
  vercelInfo,
  workspaceId,
}: CodePanelProps) {
  const [activeTab, setActiveTab] = useState<ActiveTab>("preview");

  useEffect(() => {
    if (fileData) setActiveTab("preview");
  }, [fileData]);

  const files = useMemo(() => {
    if (!fileData || !fileData.files) return PLACEHOLDER_FILES;
    
    // Inject the base React boilerplate
    const f: Record<string, { code: string }> = { ...VITE_REACT_BOILERPLATE };
    
    // Override with AI-generated files, normalizing /src paths to root
    for (const [key, val] of Object.entries(fileData.files)) {
      if (val && typeof val.code === "string") {
        let normalizedKey = key;
        if (normalizedKey.startsWith("/src/")) {
          normalizedKey = normalizedKey.replace("/src/", "/");
        }
        let rawCode = val.code;
        if (typeof rawCode === "string") {
          rawCode = rawCode.replace(/^```[a-z]*\n/i, "").replace(/\n```$/i, "");
        }
        f[normalizedKey] = { ...val, code: rawCode };
      }
    }
    
    // react template uses .js — map /App.jsx → /App.js if needed
    if (f["/App.jsx"] && !f["/App.js"]) {
      f["/App.js"] = f["/App.jsx"];
      delete f["/App.jsx"];
    }
    // Also map any /components/*.jsx → .js
    for (const path of Object.keys(f)) {
      if (path.endsWith(".jsx") && !f[path.replace(".jsx", ".js")]) {
        f[path.replace(".jsx", ".js")] = f[path];
        delete f[path];
      }
    }
    // Inject env variables directly into process.env at runtime safely
    if (fileData?.envVars && Object.keys(fileData.envVars).length > 0) {
      const envInject = `window.process = window.process || {}; window.process.env = { ...window.process.env, ...${JSON.stringify(fileData.envVars)} };\n`;
      if (f["/index.js"]) {
        f["/index.js"].code = envInject + f["/index.js"].code;
      }
    }

    return f;
  }, [fileData]);
  const dependencies = {
    ...BASE_DEPENDENCIES,
    ...(fileData?.dependencies ?? {}),
  };

  // Key on workspaceId or placeholder state so it remounts when switching projects or first generation
  const workspaceKey = fileData ? "loaded" : "placeholder";
  const providerKey = workspaceKey; // Removed filePathKey to stop remounts crashing Nodebox

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <SandpackProvider
        key={providerKey}
        template="react"
        theme={dracula}
        files={files}
        customSetup={{ 
          dependencies
        }}
        options={{
          externalResources: ["https://cdn.tailwindcss.com"],
          recompileMode: "delayed",
          recompileDelay: 500,
        }}
      >
        <SandpackInner
          isGenerating={isGenerating}
          statusLog={statusLog}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onImprove={onImprove}
          onFixError={onFixError}
          fileData={fileData}
          appTitle={appTitle}
          isImproving={isImproving}
          isProUser={isProUser}
          onEnvVarsChange={onEnvVarsChange}
          subdomain={subdomain}
          processedFiles={files}
          vercelInfo={vercelInfo}
          workspaceId={workspaceId}
        />
      </SandpackProvider>
    </div>
  );
}
