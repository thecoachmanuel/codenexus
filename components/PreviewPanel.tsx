import { useEffect, useState } from "react";
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

export function PreviewPanel({ fileData, onError }: PreviewPanelProps) {
  const [files, setFiles] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!fileData?.files) return;
    const newFiles: Record<string, string> = {};
    let hasIndexHtml = false;
    let hasTailwindConfig = false;

    for (const [path, obj] of Object.entries(fileData.files)) {
      let code = obj.code || "";
      let cleanPath = path;

      // Sandpack expects root paths to start with /
      if (!cleanPath.startsWith("/")) {
        cleanPath = "/" + cleanPath.replace(/^\.\//, "");
      }

      if (cleanPath.endsWith("index.html")) hasIndexHtml = true;
      if (cleanPath.endsWith("tailwind.config.js")) hasTailwindConfig = true;

      newFiles[cleanPath] = code;
    }

    // Natively inject Tailwind CDN into index.html if the AI generated a Tailwind configuration
    // but didn't output a postcss.config.js to compile it natively.
    if (hasTailwindConfig && hasIndexHtml) {
      if (newFiles["/index.html"] && !newFiles["/index.html"].includes("tailwindcss.com")) {
         newFiles["/index.html"] = newFiles["/index.html"].replace(
           "</head>", 
           `  <script src="https://cdn.tailwindcss.com"></script>\n</head>`
         );
      }
    } else if (hasTailwindConfig && !hasIndexHtml) {
      newFiles["/index.html"] = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Vite App</title>
    <script src="https://cdn.tailwindcss.com"></script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>`;
    }

    setFiles(newFiles);
    onError(null); // Clear errors on new data
  }, [fileData, onError]);

  const fileCount = Object.keys(files).length;
  const isIdle = fileCount === 0;

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
          <span>{isIdle ? "Waiting for generated files..." : "Running perfectly in Sandpack"}</span>
        </div>
      </div>

      {/* Preview Container */}
      <div className="flex-1 relative bg-white overflow-hidden">
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
            theme="dark"
            files={files}
            options={{
              classes: {
                "sp-wrapper": "h-full w-full",
                "sp-layout": "h-full w-full border-none bg-white",
                "sp-preview-container": "h-full w-full",
                "sp-preview-iframe": "h-full w-full border-none bg-white"
              }
            }}
          >
            <SandpackLayout className="h-full w-full !border-none !rounded-none">
              <SandpackPreview
                showOpenInCodeSandbox={false}
                showRefreshButton={true}
                className="h-full w-full flex-1"
              />
            </SandpackLayout>
          </SandpackProvider>
        )}
      </div>
    </div>
  );
}
