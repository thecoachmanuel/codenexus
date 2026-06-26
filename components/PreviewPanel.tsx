"use client";

import { useEffect, useMemo } from "react";
import { Zap } from "lucide-react";
import type { FileData } from "@/types/workspace";
import {
  SandpackProvider,
  SandpackLayout,
  SandpackPreview,
} from "@codesandbox/sandpack-react";

interface PreviewPanelProps {
  fileData: FileData | null;
  onError: (error: string | null) => void;
}

function buildSandpackFiles(fileData: FileData): Record<string, string> {
  const newFiles: Record<string, string> = {};

  for (const [path, obj] of Object.entries(fileData.files)) {
    let code = obj.code || "";
    let cleanPath = path;

    // Sandpack expects root paths to start with /
    if (!cleanPath.startsWith("/")) {
      cleanPath = "/" + cleanPath.replace(/^\.\//, "");
    }

    // Sanitize JSON files - fix trailing commas that cause crashes
    if (cleanPath.endsWith(".json")) {
      try {
        JSON.parse(code);
      } catch {
        try {
          const fixedCode = code.replace(/,\s*}/g, "}").replace(/,\s*\]/g, "]");
          JSON.parse(fixedCode);
          code = fixedCode;
        } catch {
          code = cleanPath === "/package.json"
            ? '{"name":"app","dependencies":{"react":"^18.0.0","react-dom":"^18.0.0"}}'
            : "{}";
        }
      }
    }

    newFiles[cleanPath] = code;
  }

  return newFiles;
}

export function PreviewPanel({ fileData, onError }: PreviewPanelProps) {
  useEffect(() => {
    onError(null);
  }, [fileData, onError]);

  const files = useMemo(() => {
    if (!fileData?.files) return null;
    return buildSandpackFiles(fileData);
  }, [fileData]);

  const isIdle = !files || Object.keys(files).length === 0;

  return (
    <div className="flex flex-col h-full w-full bg-[#0a0a0a]">
      {/* Status bar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/5 bg-[#111] shrink-0">
        <div className="flex items-center gap-2 text-xs text-white/50">
          <div
            className={`h-2 w-2 rounded-full ${
              isIdle ? "bg-white/20" : "bg-green-400 animate-pulse"
            }`}
          />
          <span>{isIdle ? "Waiting for generated files..." : "⚡ Live Preview (Sandpack)"}</span>
        </div>
      </div>

      {/* Preview Container */}
      <div className="flex-1 relative overflow-hidden">
        {isIdle ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#0a0a0a]">
            <Zap className="h-10 w-10 text-white/10" />
            <div className="text-center">
              <p className="text-sm text-white/30">Live preview will appear here</p>
              <p className="text-xs text-white/15 mt-1">Generate an app to get started</p>
            </div>
          </div>
        ) : (
          <SandpackProvider
            template="vite-react"
            theme="light"
            files={files}
            options={{
              externalResources: [
                "https://cdn.tailwindcss.com",
              ],
              classes: {
                "sp-wrapper": "!h-full !w-full",
                "sp-layout": "!h-full !w-full !border-none !rounded-none",
              },
            }}
          >
            <SandpackLayout>
              <SandpackPreview
                showOpenInCodeSandbox={false}
                showRefreshButton={true}
                style={{ height: "100%", flex: 1 }}
              />
            </SandpackLayout>
          </SandpackProvider>
        )}
      </div>
    </div>
  );
}
