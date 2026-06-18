import { useState, useEffect, useRef } from "react";
import { getWebContainer, mountFiles, installDependencies, startDevServer } from "@/lib/webcontainer-client";
import { TaskGraphView } from "./TaskGraphView";
import type { TaskGraph, ContainerState, FullstackFileData } from "@/types/fullstack";
import { Loader2, Play, Terminal, Wrench, ExternalLink, RefreshCw } from "lucide-react";
import { GitHubExportModal } from "./GitHubExportModal";

interface FullstackPanelProps {
  taskGraph: TaskGraph | null;
  fileData: FullstackFileData | null;
  isBuilding: boolean;
  onDebug: (errorLog: string) => void;
  isDebugging: boolean;
  workspaceId: string;
}

export function FullstackPanel({
  taskGraph,
  fileData,
  isBuilding,
  onDebug,
  isDebugging,
  workspaceId,
}: FullstackPanelProps) {
  const [containerState, setContainerState] = useState<ContainerState>({
    status: "idle",
    previewUrl: null,
    log: [],
    error: null,
  });

  const [activeTab, setActiveTab] = useState<"preview" | "tasks" | "terminal">("preview");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  
  // Auto-scroll logs
  useEffect(() => {
    if (activeTab === "terminal" && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [containerState.log, activeTab]);

  // Boot WebContainer when fileData arrives and we're not building/debugging
  useEffect(() => {
    if (!fileData || isBuilding || isDebugging) return;

    let mounted = true;

    async function bootContainer() {
      try {
        setContainerState(s => ({ ...s, status: "booting", log: [...s.log, "> Booting WebContainer..."] }));
        const container = await getWebContainer();
        if (!mounted) return;

        setContainerState(s => ({ ...s, status: "writing", log: [...s.log, "> Mounting files..."] }));
        await mountFiles(container, fileData!);
        if (!mounted) return;

        setContainerState(s => ({ ...s, status: "installing", log: [...s.log, "> Running npm install..."] }));
        const exitCode = await installDependencies(container, (data) => {
          if (mounted) setContainerState(s => ({ ...s, log: [...s.log, data] }));
        });
        
        if (!mounted) return;

        if (exitCode !== 0) {
          throw new Error("npm install failed");
        }

        setContainerState(s => ({ ...s, status: "starting", log: [...s.log, "> Starting dev server..."] }));
        await startDevServer(
          container,
          (data) => {
            if (mounted) setContainerState(s => ({ ...s, log: [...s.log, data] }));
          },
          (url) => {
            if (mounted) {
              setContainerState(s => ({ ...s, status: "ready", previewUrl: url, log: [...s.log, `> Server ready at ${url}`] }));
            }
          }
        );

      } catch (err) {
        if (!mounted) return;
        const msg = err instanceof Error ? err.message : String(err);
        setContainerState(s => ({ ...s, status: "error", error: msg, log: [...s.log, `[ERROR] ${msg}`] }));
      }
    }

    bootContainer();

    return () => {
      mounted = false;
    };
  }, [fileData, isBuilding, isDebugging]);

  const handleFixError = () => {
    // Send the last 50 lines of logs to the debugger
    const errorLog = containerState.log.slice(-50).join("\n");
    onDebug(errorLog);
  };

  const handleReload = () => {
    if (iframeRef.current && containerState.previewUrl) {
      iframeRef.current.src = containerState.previewUrl;
    }
  };

  return (
    <div className="flex h-full w-full bg-[#0a0a0a] text-white overflow-hidden font-sans border-t border-white/5 lg:border-t-0 lg:border-l">
      
      {/* Left Pane: Task Graph */}
      <div className="w-80 border-r border-white/10 flex flex-col bg-[#0f0f0f]">
        <div className="p-4 border-b border-white/10 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Build Plan</h2>
          {isBuilding && <Loader2 className="w-4 h-4 animate-spin text-blue-500" />}
        </div>
        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
          {taskGraph ? (
            <TaskGraphView taskGraph={taskGraph} />
          ) : (
            <div className="text-gray-500 text-sm italic text-center mt-10">
              Waiting for planner agent...
            </div>
          )}
        </div>
      </div>

      {/* Main Pane: Preview & Logs */}
      <div className="flex-1 flex flex-col min-w-0">
        
        {/* Top bar */}
        <div className="h-12 border-b border-white/10 flex items-center px-4 justify-between bg-[#141414]">
          <div className="flex items-center gap-2">
            <TabButton 
              active={activeTab === "preview"} 
              onClick={() => setActiveTab("preview")}
              icon={<Play className="w-3.5 h-3.5" />}
              label="Preview"
            />
            <TabButton 
              active={activeTab === "terminal"} 
              onClick={() => setActiveTab("terminal")}
              icon={<Terminal className="w-3.5 h-3.5" />}
              label="Terminal"
            />
          </div>

          <div className="flex items-center gap-2">
             {containerState.status === "error" && !isDebugging && (
              <button 
                onClick={handleFixError}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-red-500/20 text-red-400 rounded-md hover:bg-red-500/30 transition-colors"
              >
                <Wrench className="w-3.5 h-3.5" />
                Fix with AI
              </button>
            )}
            
            {isDebugging && (
              <div className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-amber-400 bg-amber-400/10 rounded-md">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Debugger Running...
              </div>
            )}

            {fileData && containerState.status === "ready" && (
              <GitHubExportModal 
                appTitle={fileData.appName ?? null}
                fileData={{
                  files: Object.fromEntries(
                    Object.entries(fileData.files).map(([k,v]) => [k, { code: v }])
                  ) as any, // casting to avoid strict type mismatch since original is slightly different
                  dependencies: fileData.dependencies,
                  title: fileData.appName
                }}
              >
                <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white/10 text-white rounded-md hover:bg-white/20 transition-colors">
                  Export to GitHub
                </button>
              </GitHubExportModal>
            )}
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 relative bg-black">
          
          {/* PREVIEW TAB */}
          <div className={`absolute inset-0 flex flex-col ${activeTab === "preview" ? "opacity-100 z-10" : "opacity-0 z-0 pointer-events-none"}`}>
            {containerState.previewUrl ? (
              <>
                <div className="h-10 bg-white/5 border-b border-white/10 flex items-center px-4 gap-3">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-red-500/80"></div>
                    <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/80"></div>
                    <div className="w-2.5 h-2.5 rounded-full bg-green-500/80"></div>
                  </div>
                  <div className="flex-1 max-w-md mx-auto bg-black/50 border border-white/10 rounded px-3 py-1 flex items-center gap-2 text-xs text-gray-400 truncate">
                    <span>{containerState.previewUrl}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={handleReload} className="p-1.5 text-gray-400 hover:text-white transition-colors" title="Reload iframe">
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                    <a href={containerState.previewUrl} target="_blank" rel="noreferrer" className="p-1.5 text-gray-400 hover:text-white transition-colors" title="Open in new tab">
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>
                <iframe 
                  ref={iframeRef}
                  src={containerState.previewUrl} 
                  className="flex-1 w-full border-0 bg-white"
                  title="WebContainer Preview"
                  allow="cross-origin-isolated"
                />
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-gray-500 gap-4">
                {containerState.status === "idle" || containerState.status === "error" ? (
                  <Terminal className="w-8 h-8 opacity-20" />
                ) : (
                  <Loader2 className="w-8 h-8 animate-spin opacity-50" />
                )}
                <p className="text-sm uppercase tracking-widest font-mono">
                  {containerState.status === "idle" ? "Waiting for files" : 
                   containerState.status === "booting" ? "Booting WebContainer" :
                   containerState.status === "writing" ? "Mounting Filesystem" :
                   containerState.status === "installing" ? "Running npm install" :
                   containerState.status === "starting" ? "Starting Dev Server" :
                   containerState.status === "error" ? "Container Error" : ""}
                </p>
              </div>
            )}
          </div>

          {/* TERMINAL TAB */}
          <div className={`absolute inset-0 bg-[#0d0d0d] p-4 overflow-y-auto font-mono text-[13px] leading-relaxed custom-scrollbar ${activeTab === "terminal" ? "opacity-100 z-10" : "opacity-0 z-0 pointer-events-none"}`}>
             {containerState.log.length === 0 ? (
               <div className="text-gray-600 italic">No output yet...</div>
             ) : (
               containerState.log.map((line, i) => (
                 <div key={i} className={`${line.includes("ERROR") || line.includes("ERR!") ? "text-red-400" : line.startsWith(">") ? "text-blue-400 font-bold mt-2" : "text-gray-300"} whitespace-pre-wrap`}>
                   {line}
                 </div>
               ))
             )}
             <div ref={logEndRef} />
          </div>

        </div>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
        active ? "bg-white/10 text-white" : "text-gray-400 hover:bg-white/5 hover:text-gray-200"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
