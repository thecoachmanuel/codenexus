"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { WebContainer } from "@webcontainer/api";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { Loader2, Terminal as TerminalIcon, RefreshCw } from "lucide-react";
import type { FileData } from "@/types/workspace";

declare global {
  interface Window {
    __wc_instance?: WebContainer;
    __wc_boot_promise?: Promise<WebContainer>;
  }
}

interface PreviewPanelProps {
  fileData: FileData | null;
  onError: (error: string) => void;
}

type Phase = "idle" | "booting" | "installing" | "starting" | "ready" | "error";

export function PreviewPanel({ fileData, onError }: PreviewPanelProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const devProcessRef = useRef<any>(null);

  const [url, setUrl] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [showTerminal, setShowTerminal] = useState(false);

  // Boot the terminal UI (xterm.js) as soon as the component mounts
  useEffect(() => {
    if (!terminalRef.current || xtermRef.current) return;
    const term = new Terminal({
      convertEol: true,
      theme: { background: "#0a0a0a", foreground: "#d4d4d4" },
      fontSize: 12,
      fontFamily: "Menlo, Monaco, 'Courier New', monospace",
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    fitAddon.fit();
    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    const ro = new ResizeObserver(() => fitAddon.fit());
    ro.observe(terminalRef.current);

    return () => ro.disconnect();
  }, []);

  const runApp = useCallback(async (data: FileData) => {
    const term = xtermRef.current;
    if (!term || !data?.files || Object.keys(data.files).length === 0) return;

    // Kill any existing dev process
    if (devProcessRef.current) {
      try { devProcessRef.current.kill(); } catch {}
      devProcessRef.current = null;
    }
    setUrl(null);

    try {
      // 1. Boot WebContainer (singleton)
      if (!window.__wc_instance) {
        setPhase("booting");
        term.writeln("\x1b[36m◆ Booting WebContainer...\x1b[0m");
        if (!window.__wc_boot_promise) {
          window.__wc_boot_promise = WebContainer.boot();
        }
        window.__wc_instance = await window.__wc_boot_promise;

        window.__wc_instance.on("server-ready", (port, serverUrl) => {
          term.writeln(`\x1b[32m✓ Server ready at ${serverUrl}\x1b[0m`);
          setUrl(serverUrl);
          setPhase("ready");
        });
      }
      const wc = window.__wc_instance;

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

      // 3. npm install
      setPhase("installing");
      term.writeln("\x1b[36m◆ Running npm install...\x1b[0m");
      const install = await wc.spawn("npm", ["install"]);
      install.output.pipeTo(
        new WritableStream({ write(chunk) { term.write(chunk); } })
      );
      const exitCode = await install.exit;
      if (exitCode !== 0) {
        term.writeln(`\x1b[31m✗ npm install failed (exit ${exitCode})\x1b[0m`);
        setPhase("error");
        onError(`npm install failed with exit code ${exitCode}`);
        return;
      }
      term.writeln("\x1b[32m✓ Dependencies installed\x1b[0m");

      // 4. Determine start script
      let startScript = "dev";
      const pkgRaw = data.files["/package.json"]?.code || data.files["package.json"]?.code;
      if (pkgRaw) {
        try {
          const pkg = JSON.parse(pkgRaw);
          if (pkg.scripts?.dev) startScript = "dev";
          else if (pkg.scripts?.start) startScript = "start";
        } catch {}
      }

      // 5. Start dev server
      setPhase("starting");
      term.writeln(`\x1b[36m◆ Running npm run ${startScript}...\x1b[0m`);
      const dev = await wc.spawn("npm", ["run", startScript]);
      devProcessRef.current = dev;
      dev.output.pipeTo(
        new WritableStream({ write(chunk) { term.write(chunk); } })
      );
    } catch (err: any) {
      const msg = err?.message || String(err);
      term.writeln(`\x1b[31m✗ Error: ${msg}\x1b[0m`);
      setPhase("error");
      onError(msg);
    }
  }, [onError]);

  // Debounce fileData changes – only re-run when files change significantly
  const fileDataRef = useRef<FileData | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!fileData?.files) return;
    const fileCount = Object.keys(fileData.files).length;
    if (fileCount === 0) return;

    // Only run if files actually changed
    const prevCount = Object.keys(fileDataRef.current?.files || {}).length;
    fileDataRef.current = fileData;

    // Clear previous debounce
    if (debounceRef.current) clearTimeout(debounceRef.current);

    // Debounce by 2s to wait for streaming to finish
    debounceRef.current = setTimeout(() => {
      runApp(fileData);
    }, 2000);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [fileData, runApp]);

  const statusLabel: Record<Phase, string> = {
    idle: "Waiting for generated files...",
    booting: "Booting WebContainer...",
    installing: "Installing dependencies...",
    starting: "Starting dev server...",
    ready: "Running",
    error: "Error",
  };

  return (
    <div className="flex flex-col h-full w-full bg-[#0a0a0a]">
      {/* Status bar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/5 bg-[#111] shrink-0">
        <div className="flex items-center gap-2 text-xs text-white/50">
          <div className={`h-2 w-2 rounded-full ${
            phase === "ready" ? "bg-green-400 animate-pulse" :
            phase === "error" ? "bg-red-400" :
            phase === "idle" ? "bg-white/20" :
            "bg-yellow-400 animate-pulse"
          }`} />
          <span>{statusLabel[phase]}</span>
          {phase !== "idle" && phase !== "ready" && phase !== "error" && (
            <Loader2 className="h-3 w-3 animate-spin" />
          )}
        </div>
        <div className="flex items-center gap-2">
          {url && (
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
            className={`text-white/30 hover:text-white/70 transition-colors ${showTerminal ? "text-white/70" : ""}`}
            title="Toggle terminal"
          >
            <TerminalIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Preview iframe */}
      <div className={`flex-1 relative bg-white overflow-hidden transition-all ${showTerminal ? "flex-[3]" : "flex-1"}`}>
        {url ? (
          <iframe
            src={url}
            className="absolute inset-0 w-full h-full border-0"
            title="App Preview"
            allow="cross-origin-isolated"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0a0a0a]">
            {phase === "idle" ? (
              <>
                <div className="text-white/20 text-4xl">⚡</div>
                <p className="text-sm text-white/30">Generate an app to see the live preview</p>
              </>
            ) : phase === "error" ? (
              <>
                <div className="text-red-400 text-3xl">✗</div>
                <p className="text-sm text-red-400/70">Preview failed — check the terminal</p>
                <button
                  onClick={() => runApp(fileDataRef.current!)}
                  className="mt-2 text-xs text-white/50 border border-white/10 rounded px-3 py-1.5 hover:bg-white/5 transition-colors"
                >
                  Retry
                </button>
              </>
            ) : (
              <>
                <Loader2 className="h-8 w-8 animate-spin text-blue-400/60" />
                <p className="text-sm text-white/40">{statusLabel[phase]}</p>
                <p className="text-xs text-white/20">This usually takes 20-60 seconds</p>
              </>
            )}
          </div>
        )}
      </div>

      {/* Terminal */}
      {showTerminal && (
        <div className="flex-1 border-t border-white/5 bg-[#0a0a0a] overflow-hidden" style={{ minHeight: 160, maxHeight: 300 }}>
          <div ref={terminalRef} className="h-full w-full p-1" />
        </div>
      )}
      {/* Always mount the terminal div for xterm, but hide it visually when not shown */}
      {!showTerminal && (
        <div ref={terminalRef} className="h-0 w-0 overflow-hidden" />
      )}
    </div>
  );
}
