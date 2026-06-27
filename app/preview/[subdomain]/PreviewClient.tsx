"use client";

import { useMemo } from "react";
import { SandpackProvider, SandpackLayout, SandpackPreview } from "@codesandbox/sandpack-react";
import { buildSandpackFiles } from "@/components/PreviewPanel";
import type { FileData } from "@/types/workspace";

export function PreviewClient({ fileData }: { fileData: FileData }) {
  const { files, deps } = useMemo(() => buildSandpackFiles(fileData), [fileData]);

  return (
    <div className="w-screen h-screen overflow-hidden bg-white relative flex flex-col">
      <SandpackProvider
        template="react-ts"
        theme="light"
        files={files}
        customSetup={{
          dependencies: {
            react: "^18.0.0",
            "react-dom": "^18.0.0",
            ...deps,
          },
        }}
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
        <SandpackLayout className="h-full w-full flex-1">
          <SandpackPreview
            showOpenInCodeSandbox={false}
            showRefreshButton={false}
            showNavigator={false}
            style={{ height: "100%", flex: 1 }}
          />
        </SandpackLayout>
      </SandpackProvider>

      {/* Watermark */}
      <a 
        href="https://crevoai.website" 
        target="_blank" 
        rel="noopener noreferrer"
        className="fixed bottom-4 right-4 z-50 flex items-center gap-2 bg-black/80 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 shadow-xl hover:bg-black transition-colors"
      >
        <span className="text-white/80 text-xs font-medium">Built with</span>
        <span className="text-transparent bg-clip-text bg-gradient-to-r from-white to-indigo-300 text-xs font-bold">Crevo AI</span>
      </a>
    </div>
  );
}
