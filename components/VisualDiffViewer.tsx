import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle } from "lucide-react";
import type { FileData } from "@/types/workspace";

interface VisualDiffViewerProps {
  originalData: FileData | null;
  proposedData: FileData;
  onAccept: () => void;
  onReject: () => void;
}

export function VisualDiffViewer({ originalData, proposedData, onAccept, onReject }: VisualDiffViewerProps) {
  // Find which files changed
  const originalFiles = originalData?.files || {};
  const proposedFiles = proposedData.files || {};
  
  const allPaths = Array.from(new Set([...Object.keys(originalFiles), ...Object.keys(proposedFiles)]));
  
  const changedPaths = allPaths.filter(path => {
    const orig = originalFiles[path]?.code || "";
    const prop = proposedFiles[path]?.code || "";
    return orig !== prop;
  });

  const [activeFile, setActiveFile] = useState<string | null>(changedPaths.length > 0 ? changedPaths[0] : null);

  if (changedPaths.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 text-center bg-[#0a0a0a]">
        <h3 className="text-lg font-medium text-white mb-2">No Changes Detected</h3>
        <p className="text-white/50 text-sm mb-6">The Agent did not modify any code.</p>
        <Button onClick={onAccept} className="bg-white text-black hover:bg-white/90">
          Continue
        </Button>
      </div>
    );
  }

  const oldCode = activeFile ? (originalFiles[activeFile]?.code || "/* File did not exist */") : "";
  const newCode = activeFile ? (proposedFiles[activeFile]?.code || "/* File was deleted */") : "";

  return (
    <div className="flex h-full flex-col bg-[#0d0d0d] text-white">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 p-4">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            Review Changes
            <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-xs text-blue-400 font-medium">
              {changedPaths.length} file{changedPaths.length > 1 ? 's' : ''} modified
            </span>
          </h2>
          <p className="text-sm text-white/50">Approve or reject the Agent's code improvements.</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="ghost" onClick={onReject} className="text-red-400 hover:text-red-300 hover:bg-red-400/10">
            <XCircle className="w-4 h-4 mr-2" />
            Reject
          </Button>
          <Button onClick={onAccept} className="bg-white text-black hover:bg-white/90">
            <CheckCircle2 className="w-4 h-4 mr-2" />
            Accept Changes
          </Button>
        </div>
      </div>

      {/* Main Diff Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar: File List */}
        <div className="w-64 shrink-0 overflow-y-auto border-r border-white/10 bg-[#0a0a0a] p-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-white/40 mb-3 px-2 mt-2">Modified Files</h3>
          <ul className="space-y-1">
            {changedPaths.map(path => (
              <li key={path}>
                <button
                  onClick={() => setActiveFile(path)}
                  className={`w-full text-left px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    activeFile === path
                      ? "bg-blue-500/20 text-blue-300"
                      : "text-white/70 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  {path.startsWith("/") ? path.slice(1) : path}
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Diff Pane - Side by Side Comparison */}
        <div className="flex flex-1 overflow-hidden bg-[#0a0a0a]">
          {activeFile ? (
            <div className="flex flex-1 p-4 gap-4 overflow-hidden">
              {/* Old Code */}
              <div className="flex-1 flex flex-col rounded-xl border border-red-500/30 overflow-hidden bg-[#111]">
                <div className="flex items-center justify-between bg-red-500/10 px-4 py-2 border-b border-red-500/20">
                  <span className="text-sm font-semibold text-red-400">Before</span>
                  <span className="text-xs font-mono text-white/60">{activeFile}</span>
                </div>
                <div className="flex-1 overflow-auto p-4">
                  <pre className="text-[13px] leading-relaxed font-mono text-white/80 whitespace-pre-wrap break-all">
                    {oldCode}
                  </pre>
                </div>
              </div>

              {/* New Code */}
              <div className="flex-1 flex flex-col rounded-xl border border-green-500/30 overflow-hidden bg-[#111]">
                <div className="flex items-center justify-between bg-green-500/10 px-4 py-2 border-b border-green-500/20">
                  <span className="text-sm font-semibold text-green-400">After</span>
                  <span className="text-xs font-mono text-white/60">{activeFile}</span>
                </div>
                <div className="flex-1 overflow-auto p-4">
                  <pre className="text-[13px] leading-relaxed font-mono text-white/80 whitespace-pre-wrap break-all">
                    {newCode}
                  </pre>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
