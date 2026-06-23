"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import {
  Eye,
  Code2,
  Download,
  AlertTriangle,
  Bot,
  Loader2,
  Monitor,
  Tablet,
  Smartphone,
  Maximize2,
  Minimize2,
  Trash2,
  Plus,
  Rocket,
  FileCode,
  FileJson,
  FileText,
  Folder,
  Settings2
} from "lucide-react";
import { RingLoader } from "react-spinners";
import JSZip from "jszip";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PricingModal } from "@/components/PricingModal";
import { GitHubExportModal } from "@/components/GitHubExportModal";
import { VercelDeployModal } from "@/components/VercelDeployModal";
import { PreviewPanel } from "@/components/PreviewPanel";
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
  previewError: string | null;
  setPreviewError: (error: string | null) => void;
}

// ─── Simple Native Code Viewer ────────────────────────────────────────────────

function NativeCodeViewer({ files }: { files: Record<string, { code: string }> }) {
  const filePaths = Object.keys(files).sort();
  const [activeFile, setActiveFile] = useState(filePaths[0] || "");

  useEffect(() => {
    if (!activeFile && filePaths.length > 0) {
      setActiveFile(filePaths[0]);
    }
  }, [filePaths, activeFile]);

  const getFileIcon = (path: string) => {
    if (path.endsWith('.json')) return <FileJson className="h-4 w-4 text-yellow-400" />;
    if (path.endsWith('.js') || path.endsWith('.jsx') || path.endsWith('.ts') || path.endsWith('.tsx')) return <FileCode className="h-4 w-4 text-blue-400" />;
    return <FileText className="h-4 w-4 text-gray-400" />;
  };

  return (
    <div className="flex h-full w-full bg-[#1e1e1e] text-[#d4d4d4]">
      {/* Sidebar */}
      <div className="w-64 border-r border-white/10 flex flex-col overflow-y-auto overflow-x-hidden">
        <div className="p-3 text-xs font-semibold uppercase tracking-wider text-white/50 border-b border-white/10">
          Explorer
        </div>
        <div className="py-2 flex flex-col space-y-0.5">
          {filePaths.map((path) => (
            <button
              key={path}
              onClick={() => setActiveFile(path)}
              className={`flex items-center gap-2 px-3 py-1.5 text-sm transition-colors text-left truncate ${activeFile === path ? "bg-white/10 text-white" : "text-white/70 hover:bg-white/5 hover:text-white"}`}
            >
              {getFileIcon(path)}
              <span className="truncate">{path.startsWith('/') ? path.slice(1) : path}</span>
            </button>
          ))}
        </div>
      </div>
      
      {/* Editor Area */}
      <div className="flex-1 flex flex-col overflow-hidden bg-[#1e1e1e]">
        {activeFile ? (
          <>
            <div className="flex items-center px-4 py-2 border-b border-white/10 bg-[#1e1e1e]">
              <span className="text-sm text-white/80 flex items-center gap-2">
                {getFileIcon(activeFile)}
                {activeFile}
              </span>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <pre className="text-sm font-mono leading-relaxed" style={{ tabSize: 2 }}>
                <code>{files[activeFile]?.code || ""}</code>
              </pre>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-white/30">
             No file selected
          </div>
        )}
      </div>
    </div>
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
  previewError,
  setPreviewError,
}: CodePanelProps) {
  const [activeTab, setActiveTab] = useState<ActiveTab>("preview");
  const [previewMode, setPreviewMode] = useState<PreviewMode>("desktop");
  const [isExporting, setIsExporting] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [liveUrl, setLiveUrl] = useState<string | null>(null);

  useEffect(() => {
    if (fileData) setActiveTab("preview");
  }, [fileData]);

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

  const handleAddEnvVar = () => setLocalEnvVars({ ...localEnvVars, "": "" });
  const handleUpdateEnvVarKey = (oldKey: string, newKey: string, value: string) => {
    const updated = { ...localEnvVars };
    delete updated[oldKey];
    updated[newKey] = value;
    setLocalEnvVars(updated);
  };
  const handleUpdateEnvVarValue = (key: string, value: string) => setLocalEnvVars({ ...localEnvVars, [key]: value });
  const handleDeleteEnvVar = (key: string) => {
    const updated = { ...localEnvVars };
    delete updated[key];
    setLocalEnvVars(updated);
  };
  const handleSaveEnvVars = () => {
    if (onEnvVarsChange) {
      const cleanEnv = Object.fromEntries(
        Object.entries(localEnvVars).filter(([k]) => k.trim() !== "")
      );
      onEnvVarsChange(cleanEnv);
    }
  };

  const handleExportZip = async () => {
    if (!fileData) return;
    setIsExporting(true);
    try {
      const zip = new JSZip();
      for (const [path, obj] of Object.entries(fileData.files || {})) {
        let code = obj.code;
        if (typeof code === "string") {
          code = code.replace(/^\s*\`\`\`[a-z]*\n/i, "").replace(/\n\`\`\`\s*$/i, "");
        }
        zip.file(path.startsWith("/") ? path.slice(1) : path, code);
      }
      
      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${appTitle || "generated-app"}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
    } finally {
      setIsExporting(false);
    }
  };

  const files = useMemo(() => {
    if (!fileData || !fileData.files) return {};
    const f: Record<string, { code: string }> = {};
    for (const [key, val] of Object.entries(fileData.files)) {
      if (val && typeof val.code === "string") {
        let normalizedKey = key.startsWith("/") ? key : "/" + key;
        let rawCode = val.code;
        if (typeof rawCode === "string") {
          rawCode = rawCode.replace(/^\`\`\`[a-z]*\n/i, "").replace(/\n\`\`\`$/i, "");
        }
        f[normalizedKey] = { code: rawCode };
      }
    }
    return f;
  }, [fileData]);

  const currentStepLabel = statusLog.length > 0 ? statusLog[statusLog.length - 1].label : "Building your app...";

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Top Navbar */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/5 bg-[#0a0a0a] px-2 sm:px-4">
        <div className="flex items-center gap-4">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ActiveTab)}>
            <TabsList className="bg-white/5">
              <TabsTrigger
                value="preview"
                className="data-[state=active]:bg-white/10 data-[state=active]:text-white"
              >
                <Eye className="mr-2 h-4 w-4" />
                Preview
              </TabsTrigger>
              <TabsTrigger
                value="code"
                className="data-[state=active]:bg-white/10 data-[state=active]:text-white"
              >
                <Code2 className="mr-2 h-4 w-4" />
                Code
              </TabsTrigger>
              <TabsTrigger
                value="env"
                className="data-[state=active]:bg-white/10 data-[state=active]:text-white"
              >
                <Settings2 className="mr-2 h-4 w-4 hidden sm:block" />
                <span className="hidden sm:inline">Env</span>
                <span className="sm:hidden">.env</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div className="flex items-center gap-1 sm:gap-2">
          {!isProUser && <PricingModal />}

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
      <div className="relative flex-1 overflow-hidden h-full bg-[#0a0a0a]">
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

        {/* PREVIEW TAB */}
        <div className={`absolute inset-0 ${activeTab === "preview" ? "block" : "hidden"} ${isFullscreen ? "fixed z-50" : ""}`}>
            {/* Viewport Toggles */}
            <div className="hidden md:flex absolute top-4 right-4 z-10 items-center gap-1 rounded-lg border border-black/10 bg-white/50 p-1 backdrop-blur-md shadow-lg opacity-60 hover:opacity-100">
              <button
                onClick={() => setPreviewMode("mobile")}
                className={`rounded-md p-1.5 transition-colors ${previewMode === "mobile" ? "bg-black/10 text-black shadow-sm" : "text-gray-600 hover:bg-black/5 hover:text-black"}`}
                title="Mobile Preview"
              >
                <Smartphone className="h-4 w-4" />
              </button>
              <button
                onClick={() => setPreviewMode("tablet")}
                className={`rounded-md p-1.5 transition-colors ${previewMode === "tablet" ? "bg-black/10 text-black shadow-sm" : "text-gray-600 hover:bg-black/5 hover:text-black"}`}
                title="Tablet Preview"
              >
                <Tablet className="h-4 w-4" />
              </button>
              <button
                onClick={() => setPreviewMode("desktop")}
                className={`rounded-md p-1.5 transition-colors ${previewMode === "desktop" ? "bg-black/10 text-black shadow-sm" : "text-gray-600 hover:bg-black/5 hover:text-black"}`}
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
                {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </button>
            </div>

            <div
              className={`transition-all duration-500 ease-in-out mx-auto h-full ${
                previewMode === "mobile"
                  ? "h-[812px] w-[375px] shrink-0 overflow-hidden rounded-[2.5rem] border-[8px] border-black ring-4 ring-white/10 shadow-2xl my-8"
                  : previewMode === "tablet"
                  ? "h-[1024px] w-[768px] shrink-0 overflow-hidden rounded-[2rem] border-[8px] border-black ring-4 ring-white/10 shadow-2xl my-8"
                  : "w-full"
              }`}
              style={{ height: (previewMode === "desktop" && !isFullscreen) ? "100%" : undefined }}
            >
              <PreviewPanel 
                key={fileData ? "loaded" : "empty"}
                fileData={fileData}
                onError={(err) => setPreviewError(err)}
              />
            </div>
        </div>

        {/* CODE TAB */}
        <div className={`absolute inset-0 ${activeTab === "code" ? "block" : "hidden"}`}>
           <NativeCodeViewer files={files} />
        </div>

        {/* ENV TAB */}
        <div className={`absolute inset-0 ${activeTab === "env" ? "block" : "hidden"} overflow-y-auto p-6 text-white`}>
            <div className="mx-auto max-w-2xl space-y-6">
              <div>
                <h3 className="text-lg font-medium text-white/90">Environment Variables</h3>
                <p className="mt-1 text-sm text-white/50">
                  Configure variables like your MongoDB Atlas Data API keys here. These will be injected into <code>process.env</code> for the generated Node backend.
                </p>
              </div>

              <div className="space-y-3">
                {Object.entries(localEnvVars).map(([key, value], idx) => (
                  <div key={idx} className="flex items-center gap-3">
                    <input
                      type="text"
                      placeholder="KEY (e.g. MONGO_URI)"
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
        </div>
      </div>

      {/* Preview error banner */}
      {previewError &&
        !isGenerating &&
        !isImproving &&
        activeTab === "preview" && (
          <div className="absolute inset-x-0 bottom-0 z-20 border-t border-red-500/20 bg-red-950 p-4 shadow-xl">
            <div className="flex items-center gap-2.5">
              <AlertTriangle className="h-4 w-4 shrink-0 text-red-400/70" />
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
                className="shrink-0"
              >
                <Bot className="h-3 w-3 mr-1.5" />
                Fix with AI
              </Button>
            </div>
          </div>
        )}
    </div>
  );
}
