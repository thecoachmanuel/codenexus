"use client";

import { useEffect, useMemo, useRef } from "react";
import { Zap } from "lucide-react";
import type { FileData } from "@/types/workspace";
import {
  SandpackProvider,
  SandpackLayout,
  SandpackPreview,
  useSandpack,
} from "@codesandbox/sandpack-react";

interface PreviewPanelProps {
  fileData: FileData | null;
  onError: (error: string | null) => void;
  hideStatusBar?: boolean;
}

function ErrorListener({ onError }: { onError: (error: string | null) => void }) {
  const { sandpack } = useSandpack();
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    if (sandpack.error?.message) {
      // Capture compilation and runtime errors immediately
      onErrorRef.current(sandpack.error.message);
    }
  }, [sandpack.error?.message]);

  return null;
}

// Config/build-tool files that the Sandpack browser bundler cannot parse
const SKIP_FILES = new Set([
  "vite.config.js", "vite.config.ts",
  "tailwind.config.js", "tailwind.config.ts", "tailwind.config.cjs",
  "postcss.config.js", "postcss.config.cjs", "postcss.config.mjs",
  "eslint.config.js", ".eslintrc.js", ".eslintrc.json", ".eslintrc.cjs",
  ".prettierrc", ".prettierrc.js", ".prettierrc.json",
  "jest.config.js", "jest.config.ts",
  "babel.config.js", "babel.config.json",
  "tsconfig.json", "tsconfig.node.json", "tsconfig.app.json",
  ".env", ".env.local", ".env.production",
  ".gitignore", ".npmrc", "README.md", "LICENSE",
  "Makefile", "Dockerfile",
]);

function sanitizeCode(code: string): string {
  let clean = code
    .replace(/^\uFEFF/, "")   // strip UTF-8 BOM
    .replace(/\x00/g, "")     // strip null bytes
    .replace(/\r\n/g, "\n")   // normalize line endings
    .trim();

  // Fix AI hallucination: strip markdown fences (```jsx) if the AI accidentally included them inside the file
  const lines = clean.split("\n");
  
  // Strip opening fence
  if (lines[0] && lines[0].trim().startsWith("```")) {
    lines.shift();
  }
  
  // Strip closing fence
  if (lines.length > 0 && lines[lines.length - 1].trim() === "```") {
    lines.pop();
  }

  // Fallback: If there's still a stray closing fence at the very end (due to trailing spaces)
  clean = lines.join("\n").trim();
  if (clean.endsWith("```")) {
    clean = clean.slice(0, -3);
  }

  return clean;
}

export function buildSandpackFiles(fileData: FileData): {
  files: Record<string, string>;
  deps: Record<string, string>;
} {
  const files: Record<string, string> = {};
  let deps: Record<string, string> = { ...(fileData.dependencies || {}) };

  if (!fileData.files) return { files, deps };

  for (const [path, obj] of Object.entries(fileData.files)) {
    let code = sanitizeCode(obj.code || "");
    let cleanPath = path;

    // Normalize to start with /
    if (!cleanPath.startsWith("/")) {
      cleanPath = "/" + cleanPath.replace(/^\.\//, "");
    }

    const basename = cleanPath.split("/").pop() || "";

    // Extract deps from package.json but don't pass the file itself to avoid conflicts
    if (basename === "package.json") {
      try {
        const fixed = code.replace(/,\s*}/g, "}").replace(/,\s*\]/g, "]");
        const pkg = JSON.parse(fixed);
        deps = pkg.dependencies || {};
      } catch { /* ignore */ }
      continue; // Don't pass package.json to Sandpack — template manages it
    }

    // Skip Node.js/build-tool config files — browser bundler can't parse them
    if (SKIP_FILES.has(basename)) continue;

    // Only pass source-code file types
    const ext = basename.includes(".") ? "." + basename.split(".").pop()!.toLowerCase() : "";
    const allowed = [".js",".jsx",".ts",".tsx",".css",".svg",".html",".json",".md",".txt",".mdx"];
    if (!allowed.includes(ext)) continue;

    // Ensure index.html is placed where the Sandpack react template expects it
    if (cleanPath === "/index.html") {
      cleanPath = "/public/index.html";
    }

    files[cleanPath] = code;
  }

  // The 'react-ts' template needs /index.tsx or /index.js as its entrypoint.
  // If the AI generated src/main.jsx (Vite convention) or something else, create a shim.
  if (!files["/index.tsx"] && !files["/src/index.tsx"] && !files["/index.js"] && !files["/src/index.js"]) {
    const mainEntry = Object.keys(files).find(
      (p) => p.match(/\/(main|index)\.(jsx?|tsx?)$/) && !p.includes("public/")
    );
    if (mainEntry) {
      files["/index.tsx"] = `import "${mainEntry}";`;
    }
  }

  // Inject environment variables universally
  if (fileData.envVars && Object.keys(fileData.envVars).length > 0) {
    let envContent = "";
    for (const [key, value] of Object.entries(fileData.envVars)) {
      if (key.trim() === "") continue;
      envContent += `${key}=${value}\n`;
      if (!key.startsWith("VITE_")) envContent += `VITE_${key}=${value}\n`;
      if (!key.startsWith("REACT_APP_")) envContent += `REACT_APP_${key}=${value}\n`;
    }
    files["/.env"] = envContent;
  }

  return { files, deps };
}

export function PreviewPanel({ fileData, onError, hideStatusBar = false }: PreviewPanelProps) {
  useEffect(() => {
    onError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileData]);

  const { files, deps } = useMemo(() => {
    if (!fileData?.files) return { files: {} as Record<string, string>, deps: {} as Record<string, string> };
    return buildSandpackFiles(fileData);
  }, [fileData]);

  const isIdle = Object.keys(files).length === 0;

  return (
    <div className="flex flex-col h-full w-full bg-[#0a0a0a]">
      {/* Status bar */}
      {!hideStatusBar && (
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
      )}

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
            <ErrorListener onError={onError} />
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
