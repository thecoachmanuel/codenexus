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
  Trash2,
  Plus,
  Rocket,
  FileCode,
  FileJson,
  FileText,
  Folder,
  Settings2,
  X,
  Edit3
} from "lucide-react";
import { RingLoader } from "react-spinners";
import JSZip from "jszip";
import { EditSubdomainModal } from "./EditSubdomainModal";
import { VisualThemeEditor } from "./VisualThemeEditor";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from "react-resizable-panels";
import { Columns } from "lucide-react";
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

type ActiveTab = "preview" | "code" | "split" | "env";

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
  onEnvVarsChange?: (vars: Record<string, string>) => void;
  subdomain?: string | null;
  onSubdomainChange?: (newSubdomain: string) => void;
  vercelInfo?: VercelInfo;
  workspaceId?: string | null;
  previewError: string | null;
  setPreviewError: (error: string | null) => void;
}

// ─── Simple Native Code Viewer ────────────────────────────────────────────────

function NativeCodeViewer({ files }: { files: Record<string, { code: string }> }) {
  const filePaths = Object.keys(files).sort();
  const [activeFile, setActiveFile] = useState("");

  // Whenever the file list changes, select first file if nothing is selected or if the selected file no longer exists
  useEffect(() => {
    if (filePaths.length > 0 && (!activeFile || !files[activeFile])) {
      setActiveFile(filePaths[0]);
    }
  }, [filePaths.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const getFileIcon = (path: string) => {
    if (path.endsWith('.json')) return <FileJson className="h-4 w-4 text-yellow-400" />;
    if (path.endsWith('.js') || path.endsWith('.jsx') || path.endsWith('.ts') || path.endsWith('.tsx')) return <FileCode className="h-4 w-4 text-blue-400" />;
    return <FileText className="h-4 w-4 text-gray-400" />;
  };

  if (filePaths.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#1e1e1e]">
        <div className="text-center text-white/30">
          <FileCode className="h-12 w-12 mx-auto mb-3 opacity-20" />
          <p className="text-sm">No files generated yet.</p>
          <p className="text-xs mt-1 opacity-60">Generate an app to see the code here.</p>
        </div>
      </div>
    );
  }

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
      
      {/* CodePanel Container */}
      <div className="flex flex-col flex-1 min-w-0 h-full relative overflow-hidden bg-[#1e1e1e]">
        {activeFile && files[activeFile] ? (
          <>
            <div className="flex items-center px-4 py-2 border-b border-white/10 bg-[#1e1e1e]">
              <span className="text-sm text-white/80 flex items-center gap-2">
                {getFileIcon(activeFile)}
                {activeFile}
              </span>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <pre className="text-sm font-mono leading-relaxed whitespace-pre-wrap break-words" style={{ tabSize: 2 }}>
                <code>{files[activeFile]?.code || ""}</code>
              </pre>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-white/30">
            Select a file to view its contents
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
  onSubdomainChange,
  vercelInfo,
  workspaceId,
  previewError,
  setPreviewError,
}: CodePanelProps) {
  const [activeTab, setActiveTab] = useState<ActiveTab>("preview");
  const [isExporting, setIsExporting] = useState(false);
  const [liveUrl, setLiveUrl] = useState<string | null>(null);

  // Theme Editor & Click-to-Edit State
  const [isEditMode, setIsEditMode] = useState(false);
  const [clickedElement, setClickedElement] = useState<{
    html: string;
    tagName: string;
    className: string;
    rect: { top: number; left: number; width: number; height: number };
  } | null>(null);
  const [editPrompt, setEditPrompt] = useState("");

  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.data?.type === 'element_clicked') {
        setClickedElement({
          html: e.data.outerHTML,
          tagName: e.data.tagName,
          className: e.data.className,
          rect: e.data.rect
        });
      } else if (e.data?.type === 'edit_mode_disabled') {
        setIsEditMode(false);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  useEffect(() => {
    const iframes = document.querySelectorAll('iframe');
    iframes.forEach(iframe => {
      iframe.contentWindow?.postMessage({ type: 'set_edit_mode', enabled: isEditMode }, '*');
    });
    if (!isEditMode) setClickedElement(null);
  }, [isEditMode]);

  useEffect(() => {
    if (fileData) setActiveTab("preview");
  }, [fileData]);

  useEffect(() => {
    if (vercelInfo?.url) {
      setLiveUrl(vercelInfo.url);
    } else if (subdomain) {
      const host = window.location.host.replace(/^www\./, '');
      setLiveUrl(`${window.location.protocol}//${subdomain}.${host}`);
    } else {
      setLiveUrl(null);
    }
  }, [subdomain, vercelInfo?.url]);

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
      const safeTitle = (appTitle || "generated-app").toLowerCase().replace(/[^a-z0-9]+/g, '-');
      let hasPackageJson = false;
      let hasReadme = false;

      for (const [path, obj] of Object.entries(fileData.files || {})) {
        let code = obj.code;
        if (typeof code === "string") {
          code = code.replace(/^\s*\`\`\`[a-z]*\n/i, "").replace(/\n\`\`\`\s*$/i, "");
        }
        
        const cleanPath = path.startsWith("/") ? path.slice(1) : path;
        if (cleanPath === "package.json") hasPackageJson = true;
        if (cleanPath.toLowerCase() === "readme.md") hasReadme = true;

        zip.file(`${safeTitle}/${cleanPath}`, code);
      }

      if (!hasPackageJson) {
        const pkg = {
          name: safeTitle,
          version: "0.1.0",
          private: true,
          dependencies: {
            "react": "^18.2.0",
            "react-dom": "^18.2.0",
            ...fileData.dependencies
          },
          scripts: {
            "start": "react-scripts start",
            "build": "react-scripts build",
            "test": "react-scripts test",
            "eject": "react-scripts eject"
          },
          browserslist: {
            production: [">0.2%", "not dead", "not op_mini all"],
            development: ["last 1 chrome version", "last 1 firefox version", "last 1 safari version"]
          }
        };
        zip.file(`${safeTitle}/package.json`, JSON.stringify(pkg, null, 2));
      }

      if (!hasReadme) {
        const readmeContent = `# ${appTitle || "Generated App"}

This project was generated using AI.

## Getting Started

First, install the dependencies:
\`\`\`bash
npm install
# or
yarn install
\`\`\`

Then, run the development server:
\`\`\`bash
npm start
# or
yarn start
\`\`\`
`;
        zip.file(`${safeTitle}/README.md`, readmeContent);
      }
      
      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safeTitle}.zip`;
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
    <div className="flex h-full flex-col overflow-hidden">
      {/* Top Navbar */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/5 bg-[#0a0a0a] px-1 sm:px-4 overflow-x-auto [&::-webkit-scrollbar]:hidden">
        <div className="flex items-center gap-1 sm:gap-4 shrink-0">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ActiveTab)}>
            <TabsList className="bg-white/5 h-9 sm:h-10">
              <TabsTrigger
                value="preview"
                className="data-[state=active]:bg-white/10 data-[state=active]:text-white text-xs sm:text-sm px-2 sm:px-3"
              >
                <Eye className="mr-1.5 h-3.5 w-3.5 sm:mr-2 sm:h-4 sm:w-4" />
                Preview
              </TabsTrigger>
              <TabsTrigger
                value="code"
                className="data-[state=active]:bg-white/10 data-[state=active]:text-white text-xs sm:text-sm px-2 sm:px-3"
              >
                <Code2 className="mr-1.5 h-3.5 w-3.5 sm:mr-2 sm:h-4 sm:w-4" />
                Code
              </TabsTrigger>
              <TabsTrigger
                value="split"
                className="data-[state=active]:bg-white/10 data-[state=active]:text-white hidden lg:flex text-sm px-3"
              >
                <Columns className="mr-2 h-4 w-4" />
                Split
              </TabsTrigger>
              <TabsTrigger
                value="env"
                className="data-[state=active]:bg-white/10 data-[state=active]:text-white text-xs sm:text-sm px-2 sm:px-3"
              >
                <Settings2 className="mr-1.5 h-3.5 w-3.5 lg:hidden" />
                <Settings2 className="mr-2 h-4 w-4 hidden lg:block" />
                <span className="hidden lg:inline">Env</span>
                <span className="lg:hidden">.env</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div className="flex items-center gap-0.5 sm:gap-2 shrink-0 ml-2">
          {!isProUser && (
            <PricingModal reason="upgrade">
              <span className="group relative hidden 2xl:flex h-7 cursor-pointer items-center gap-1.5 overflow-hidden rounded-md border border-white/25 bg-gradient-to-r from-violet-500/10 via-fuchsia-500/10 to-cyan-500/10 px-2 sm:px-2.5 text-sm font-medium text-white/90 transition-all duration-300 hover:border-white/20 hover:from-violet-500/20 hover:via-fuchsia-500/20 hover:to-cyan-500/20 hover:text-white/90 hover:shadow-[0_0_12px_rgba(139,92,246,0.3)]">
                <span className="pointer-events-none absolute inset-0 -translate-x-full animate-[shimmer_2.5s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                <Bot className="h-3.5 w-3.5 text-violet-400 transition-colors group-hover:text-violet-300" />
                <span className="bg-gradient-to-r from-violet-300 via-fuchsia-300 to-cyan-300 bg-clip-text text-transparent">
                  Upgrade to PRO
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
              className="text-white/70 hover:text-white px-1.5 sm:px-2 h-8 sm:h-9"
              title="Deploy to Vercel"
            >
              <Rocket className="h-4 w-4" />
            </Button>
          </VercelDeployModal>

          {liveUrl && (
            <div className="flex items-center">
              <a
                href={liveUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-8 sm:h-9 items-center justify-center rounded-l-md px-1.5 sm:px-3 text-sm font-medium text-white/70 hover:bg-white/10 hover:text-white transition-colors"
                title="Open Live Site"
              >
                <Eye className="h-4 w-4 xl:mr-1.5" />
                <span className="hidden xl:inline">Live Site</span>
              </a>
              {workspaceId && subdomain && onSubdomainChange && (
                <EditSubdomainModal
                  workspaceId={workspaceId}
                  currentSubdomain={subdomain}
                  onSuccess={onSubdomainChange}
                >
                  <Button
                    variant="ghost"
                    className="h-8 sm:h-9 rounded-none rounded-r-md border-l border-white/10 px-2 text-white/50 hover:text-white hover:bg-white/10"
                    title="Edit URL"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                  </Button>
                </EditSubdomainModal>
              )}
            </div>
          )}

          <GitHubExportModal
            fileData={fileData}
            appTitle={appTitle}
          >
            <Button
              variant="ghost"
              disabled={isExporting || !fileData}
              className="text-white/70 hover:text-white px-1.5 sm:px-2 h-8 sm:h-9"
              title="Export to GitHub"
            >
              <GithubIcon className="h-4 w-4" />
            </Button>
          </GitHubExportModal>

          <Button
            variant="ghost"
            onClick={handleExportZip}
            disabled={isExporting || !fileData}
            className="text-white/70 hover:text-white px-1.5 sm:px-2 h-8 sm:h-9"
            title="Export Project"
          >
            {isExporting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin xl:mr-1.5" />
            ) : (
              <Download className="h-3.5 w-3.5 xl:mr-1.5" />
            )}
            <span className="hidden xl:inline">Export</span>
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

        {/* DYNAMIC CONTENT AREA */}
        <div className="absolute inset-0 flex relative">
          
          {/* Visual Theme Editor */}
          {(activeTab === "preview" || activeTab === "split") && !isGenerating && !isImproving && (
            <VisualThemeEditor
              fileData={fileData}
              onFilePatch={_onFilePatch}
              isEditMode={isEditMode}
              onToggleEditMode={() => setIsEditMode(!isEditMode)}
            />
          )}

          {/* Click-to-Edit Popover */}
          {clickedElement && (activeTab === "preview" || activeTab === "split") && (
            <div 
              className="absolute z-50 bg-[#1e1e1e] border border-white/20 rounded-xl shadow-2xl p-4 w-80 flex flex-col gap-3"
              style={{
                // naive positioning: adjust left if it's too far right
                top: Math.max(10, clickedElement.rect.top + clickedElement.rect.height + 60),
                left: Math.min(Math.max(10, clickedElement.rect.left), typeof window !== 'undefined' ? window.innerWidth - 350 : 0),
              }}
            >
              <div className="flex justify-between items-center">
                <span className="text-xs font-mono text-violet-400 truncate flex-1">
                  &lt;{clickedElement.tagName} {clickedElement.className ? `class="${clickedElement.className}"` : ''} /&gt;
                </span>
                <button onClick={() => setClickedElement(null)} className="text-white/50 hover:text-white ml-2 shrink-0">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <textarea
                value={editPrompt}
                onChange={(e) => setEditPrompt(e.target.value)}
                placeholder="E.g., Make this button wider and change it to red..."
                className="w-full h-24 bg-black/40 border border-white/10 rounded-md p-2.5 text-sm text-white resize-none focus:outline-none focus:border-violet-500"
                autoFocus
              />
              <div className="flex justify-end">
                <Button
                  size="sm"
                  className="bg-violet-600 hover:bg-violet-700 text-white text-xs h-8"
                  disabled={!editPrompt.trim()}
                  onClick={() => {
                    const fullRequest = `I want to modify the following element:\n\`\`\`html\n${clickedElement.html}\n\`\`\`\n\nRequest: ${editPrompt.trim()}`;
                    onImprove(fullRequest);
                    setClickedElement(null);
                    setEditPrompt("");
                  }}
                >
                  <Bot className="h-3.5 w-3.5 mr-1.5" />
                  Ask AI to Edit
                </Button>
              </div>
            </div>
          )}
          {activeTab === "split" ? (
            <PanelGroup orientation="horizontal" className="h-full w-full">
              <Panel defaultSize={50} minSize={20} className="h-full bg-[#1e1e1e]">
                <NativeCodeViewer files={files} />
              </Panel>
              <PanelResizeHandle className="w-1.5 bg-black/40 hover:bg-white/20 transition-colors cursor-col-resize flex flex-col justify-center items-center">
                 <div className="w-0.5 h-8 bg-white/20 rounded-full" />
              </PanelResizeHandle>
              <Panel defaultSize={50} minSize={20} className="h-full relative bg-white">
                <PreviewPanel 
                  key={workspaceId || "preview-split"}
                  fileData={fileData}
                  onError={(err) => setPreviewError(err)}
                />
              </Panel>
            </PanelGroup>
          ) : activeTab === "code" ? (
            <div className="h-full w-full">
               <NativeCodeViewer files={files} />
            </div>
          ) : activeTab === "preview" ? (
            <div className="h-full w-full relative">
              <PreviewPanel 
                key={workspaceId || "preview-full"}
                fileData={fileData}
                onError={(err) => setPreviewError(err)}
              />
            </div>
          ) : activeTab === "env" ? (
            <div className="h-full w-full overflow-y-auto p-6 text-white absolute inset-0 z-10 bg-[#0a0a0a]">
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
          ) : null}
        </div>
      </div>

      {/* Preview error banner */}
      {previewError &&
        !isGenerating &&
        !isImproving &&
        (activeTab === "preview" || activeTab === "split") && (
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
              <button
                onClick={() => setPreviewError(null)}
                className="ml-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                title="Dismiss error"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
    </div>
  );
}
