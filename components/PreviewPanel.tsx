"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { WebContainer } from "@webcontainer/api";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { Loader2, Terminal as TerminalIcon, RefreshCw, AlertTriangle, Zap } from "lucide-react";
import type { FileData } from "@/types/workspace";

declare global {
  interface Window {
    __wc_instance?: WebContainer;
    __wc_boot_promise?: Promise<WebContainer>;
    __wc_dev_process?: any;
    __wc_last_deps?: string;
    __wc_server_url?: string;
    __wc_is_installing?: boolean;
  }
}

interface PreviewPanelProps {
  fileData: FileData | null;
  onError: (error: string | null) => void;
}

type Phase = "idle" | "booting" | "installing" | "starting" | "ready" | "error";

// Removed isStaticApp function to ensure npm install always runs for generated apps

export function PreviewPanel({ fileData, onError }: PreviewPanelProps) {
  const [url, setUrl] = useState<string | null>(() => {
    return typeof window !== 'undefined' ? window.__wc_server_url || null : null;
  });
  const [phase, setPhase] = useState<Phase>(() => {
    return typeof window !== 'undefined' && window.__wc_server_url ? "ready" : "idle";
  });
  const [showTerminal, setShowTerminal] = useState(false);

  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const errorBufferRef = useRef<string[]>([]);
  
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  // Boot the terminal UI (xterm.js) as soon as the component mounts
  useEffect(() => {
    if (!terminalContainerRef.current || xtermRef.current) return;
    const term = new Terminal({
      convertEol: true,
      theme: {
        background: "#0d0d0d",
        foreground: "#d4d4d4",
        cursor: "#60a5fa",
        selectionBackground: "#60a5fa33",
      },
      fontSize: 12,
      fontFamily: "Menlo, Monaco, 'Courier New', monospace",
      scrollback: 500,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalContainerRef.current);
    fitAddon.fit();
    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    const ro = new ResizeObserver(() => {
      try { fitAddon.fit(); } catch {}
    });
    ro.observe(terminalContainerRef.current);

    return () => ro.disconnect();
  }, []);

  const runApp = useCallback(async (data: FileData) => {
    const term = xtermRef.current;
    if (!term || !data?.files || Object.keys(data.files).length === 0) return;

    const depsString = JSON.stringify({
      pkg: data.files["/package.json"]?.code || data.files["package.json"]?.code || "",
      vite: data.files["/vite.config.js"]?.code || data.files["vite.config.js"]?.code || "",
      next: data.files["/next.config.js"]?.code || data.files["next.config.js"]?.code || ""
    });

    // Helper to capture errors from output
    const captureErrors = (chunk: string) => {
      const errorPatterns = [
        /build error/i,
        /failed to compile/i,
        /cannot find module/i,
        /turbopack build failed/i,
        /module not found/i,
        /syntaxerror/i,
        /uncaught exception/i,
        /\[vite\] internal server error/i,
      ];
      if (errorPatterns.some(p => p.test(chunk))) {
        errorBufferRef.current.push(chunk.replace(/\x1b\[[0-9;]*m/g, "").trim());
        // Debounce error reporting — only fire after 2s of no new errors
        const snapshot = [...errorBufferRef.current];
        setTimeout(() => {
          if (JSON.stringify(errorBufferRef.current) === JSON.stringify(snapshot)) {
            const errorMsg = snapshot.slice(-5).join("\n").substring(0, 600);
            onErrorRef.current(errorMsg);
          }
        }, 2000);
      }
    };

    try {
      // 1. Boot WebContainer (singleton — only boots once per page load)
      if (!window.__wc_instance) {
        setPhase("booting");
        term.writeln("\x1b[36m◆ Booting WebContainer...\x1b[0m");
        if (!window.__wc_boot_promise) {
          window.__wc_boot_promise = WebContainer.boot();
        }
        window.__wc_instance = await window.__wc_boot_promise;
        term.writeln("\x1b[32m✓ WebContainer ready\x1b[0m");
      }
      const wc = window.__wc_instance;

      // Register server-ready listener (re-registers each time we call runApp)
      const serverReadyHandler = (port: number, serverUrl: string) => {
        term.writeln(`\x1b[32m✓ Server ready → ${serverUrl}\x1b[0m`);
        window.__wc_server_url = serverUrl;
        setUrl(serverUrl);
        setPhase("ready");
        errorBufferRef.current = [];
        onErrorRef.current(null);
      };
      wc.on("server-ready", serverReadyHandler);

      // 2. Build file tree for WebContainer
      term.writeln("\x1b[36m◆ Mounting files...\x1b[0m");
      const tree: Record<string, any> = {};
      for (const [rawPath, fileObj] of Object.entries(data.files)) {
        const parts = rawPath.replace(/^\//, "").split("/").filter(Boolean);
        if (parts.length === 0) continue;
        let node = tree;
        for (let i = 0; i < parts.length; i++) {
          const part = parts[i];
          if (i === parts.length - 1) {
            node[part] = { file: { contents: (fileObj as any).code || "" } };
          } else {
            node[part] = node[part] || { directory: {} };
            node = node[part].directory;
          }
        }
      }
      await wc.mount(tree);
      term.writeln(`\x1b[32m✓ ${Object.keys(data.files).length} files mounted\x1b[0m`);

      if (window.__wc_is_installing) {
        term.writeln("\x1b[33m⚡ Files updated while installing. Continuing install...\x1b[0m");
        return;
      }

      const needsInstall = window.__wc_last_deps !== depsString;
      const needsStart = !window.__wc_dev_process;

      // If configuration hasn't changed and dev server is running, Vite HMR will automatically pick up the mounted files!
      if (!needsInstall && !needsStart) {
        term.writeln("\x1b[33m⚡ Fast Refresh (HMR) applied\x1b[0m");
        errorBufferRef.current = [];
        onErrorRef.current(null);
        return; 
      }
      
      // If we need to restart server or install, kill existing dev process
      if (window.__wc_dev_process) {
        try { window.__wc_dev_process.kill(); } catch {}
        window.__wc_dev_process = undefined;
        window.__wc_server_url = undefined;
        setUrl(null);
        errorBufferRef.current = [];
      }

      if (needsInstall) {
        window.__wc_last_deps = depsString;
        window.__wc_is_installing = true;

        // 4. pnpm install (much faster than npm in WebContainers)
        setPhase("installing");
        term.writeln("\x1b[36m◆ Installing dependencies with pnpm (fast)...\x1b[0m");
      const install = await wc.spawn("pnpm", [
        "install",
        "--prefer-offline",
        "--ignore-scripts"
      ]);
      install.output.pipeTo(
        new WritableStream({
          write(chunk) {
            term.write(chunk);
          },
        })
      );
      const exitCode = await install.exit;
      window.__wc_is_installing = false;
      
      if (exitCode !== 0) {
        const msg = `pnpm install failed (exit ${exitCode}). Check the terminal for details.`;
        term.writeln(`\x1b[31m✗ ${msg}\x1b[0m`);
        setPhase("error");
        onErrorRef.current(msg);
        return;
      }
      term.writeln("\x1b[32m✓ Dependencies installed\x1b[0m");
      }

      // 5. Determine start script from package.json
      let startScript = "dev";
      const pkgRaw =
        data.files["/package.json"]?.code || data.files["package.json"]?.code;
      if (pkgRaw) {
        try {
          const pkg = JSON.parse(pkgRaw);
          if (pkg.scripts?.dev) startScript = "dev";
          else if (pkg.scripts?.start) startScript = "start";
          else if (pkg.scripts?.serve) startScript = "serve";
        } catch {}
      }

      // 6. Start dev server using pnpm
      setPhase("starting");
      term.writeln(`\x1b[36m◆ Starting: pnpm run ${startScript}...\x1b[0m`);
      const dev = await wc.spawn("pnpm", ["run", startScript]);
      window.__wc_dev_process = dev;
      dev.output.pipeTo(
        new WritableStream({
          write(chunk) {
            term.write(chunk);
            captureErrors(chunk);
          },
        })
      );
    } catch (err: any) {
      window.__wc_is_installing = false;
      const msg = err?.message || String(err);
      term.writeln(`\x1b[31m✗ Error: ${msg}\x1b[0m`);
      setPhase("error");
      onErrorRef.current(msg);
    }
  }, []);

  // Run app when fileData changes (debounced to wait for streaming to finish)
  const fileDataRef = useRef<FileData | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasRunRef = useRef(false);

  useEffect(() => {
    if (!fileData?.files) return;
    const fileCount = Object.keys(fileData.files).length;
    if (fileCount === 0) return;

    fileDataRef.current = fileData;

    if (debounceRef.current) clearTimeout(debounceRef.current);

    // Wait 2.5s after last file change before running — avoids running during streaming
    debounceRef.current = setTimeout(() => {
      hasRunRef.current = true;
      runApp(fileData);
    }, 2500);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [fileData, runApp]);

  const phaseLabel: Record<Phase, string> = {
    idle: "Waiting for generated files...",
    booting: "Booting WebContainer...",
    installing: "Installing dependencies...",
    starting: "Starting dev server...",
    ready: "Running",
    error: "Build failed",
  };

  return (
    <div className="flex flex-col h-full w-full bg-[#0a0a0a]">
      {/* Status bar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/5 bg-[#111] shrink-0">
        <div className="flex items-center gap-2 text-xs text-white/50">
          <div
            className={`h-2 w-2 rounded-full ${
              phase === "ready"
                ? "bg-green-400 animate-pulse"
                : phase === "error"
                ? "bg-red-400"
                : phase === "idle"
                ? "bg-white/20"
                : "bg-yellow-400 animate-pulse"
            }`}
          />
          <span>{phaseLabel[phase]}</span>
          {phase !== "idle" && phase !== "ready" && phase !== "error" && (
            <Loader2 className="h-3 w-3 animate-spin" />
          )}
        </div>
        <div className="flex items-center gap-2">
          {(phase === "ready" || phase === "error") && fileDataRef.current && (
            <button
              onClick={() => runApp(fileDataRef.current!)}
              className="text-white/30 hover:text-white/70 transition-colors"
              title="Restart server"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={() => setShowTerminal((v) => !v)}
            className={`transition-colors ${
              showTerminal ? "text-white/70" : "text-white/30 hover:text-white/70"
            }`}
            title="Toggle terminal"
          >
            <TerminalIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Preview iframe */}
      <div
        className={`relative bg-white overflow-hidden transition-all duration-200 ${
          showTerminal ? "flex-[2]" : "flex-1"
        }`}
      >
        {url ? (
          <iframe
            src={url}
            className="absolute inset-0 w-full h-full border-0"
            title="App Preview"
            allow="cross-origin-isolated"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#0a0a0a]">
            {phase === "idle" ? (
              <>
                <Zap className="h-10 w-10 text-white/10" />
                <div className="text-center">
                  <p className="text-sm text-white/30">Live preview will appear here</p>
                  <p className="text-xs text-white/15 mt-1">Generate an app to get started</p>
                </div>
              </>
            ) : phase === "error" ? (
              <>
                <AlertTriangle className="h-8 w-8 text-red-400/50" />
                <div className="text-center">
                  <p className="text-sm text-red-400/70 font-medium">Build failed</p>
                  <p className="text-xs text-white/30 mt-1">
                    Open the terminal ↗ to see details, or use{" "}
                    <span className="text-blue-400/70">Fix with AI</span>
                  </p>
                </div>
                <button
                  onClick={() => runApp(fileDataRef.current!)}
                  className="text-xs text-white/40 border border-white/10 rounded-md px-3 py-1.5 hover:bg-white/5 transition-colors"
                >
                  ↺ Retry
                </button>
              </>
            ) : (
              <>
                <div className="relative">
                  <Loader2 className="h-8 w-8 animate-spin text-blue-400/50" />
                </div>
                <div className="text-center">
                  <p className="text-sm text-white/50 font-medium">{phaseLabel[phase]}</p>
                  {phase === "installing" && (
                    <p className="text-xs text-white/25 mt-1">
                      First build takes ~30–60s · Subsequent builds are faster
                    </p>
                  )}
                  {phase === "starting" && (
                    <p className="text-xs text-white/25 mt-1">Starting dev server...</p>
                  )}
                </div>
                <button
                  onClick={() => setShowTerminal(true)}
                  className="text-xs text-white/25 border border-white/5 rounded-md px-3 py-1.5 hover:bg-white/5 transition-colors"
                >
                  View terminal output
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Terminal panel - Always rendered to keep xterm.js alive, just visually collapsed via height */}
      <div
        className={`border-t border-white/5 bg-[#0d0d0d] overflow-hidden shrink-0 transition-all duration-200 ${
          showTerminal ? "h-[220px]" : "h-0 border-t-0"
        }`}
      >
        <div ref={terminalContainerRef} className="h-full w-full p-1" aria-hidden={!showTerminal} />
      </div>
    </div>
  );
}
