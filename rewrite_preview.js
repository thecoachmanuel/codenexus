const fs = require('fs');

const fileContent = `"use client";

import { useEffect, useRef, useState } from "react";
import { WebContainer } from "@webcontainer/api";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { Loader2 } from "lucide-react";
import type { FileData } from "@/types/workspace";

declare global {
  interface Window {
    webcontainerBootPromise?: Promise<WebContainer>;
  }
}

interface PreviewPanelProps {
  fileData: FileData | null;
  onError: (error: string) => void;
}

let webcontainerInstance: WebContainer | null = null;

export function PreviewPanel({ fileData, onError }: PreviewPanelProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const terminalRef = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [isBooting, setIsBooting] = useState(true);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  
  // Initialize WebContainer and Terminal
  useEffect(() => {
    let mounted = true;
    
    async function boot() {
      if (!terminalRef.current) return;
      
      if (!xtermRef.current) {
        const term = new Terminal({ convertEol: true });
        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.open(terminalRef.current);
        fitAddon.fit();
        xtermRef.current = term;
        fitAddonRef.current = fitAddon;
        
        const resizeObserver = new ResizeObserver(() => fitAddon.fit());
        resizeObserver.observe(terminalRef.current);
      }
      
      const term = xtermRef.current!;
      
      try {
        if (!webcontainerInstance) {
          term.write("Booting WebContainer...\\r\\n");
          // Avoid double booting during strict mode
          if (!window.webcontainerBootPromise) {
             window.webcontainerBootPromise = WebContainer.boot();
          }
          webcontainerInstance = await window.webcontainerBootPromise;
          
          webcontainerInstance.on("server-ready", (port, url) => {
             if (mounted) {
                setUrl(url);
                term.write(\`\\r\\nServer is ready at \${url}\\r\\n\`);
             }
          });
        }
        
        setIsBooting(false);
      } catch (err) {
        term.write(\`\\r\\nError booting WebContainer: \${err}\\r\\n\`);
        onError(String(err));
      }
    }
    
    boot();
    
    return () => {
      mounted = false;
    };
  }, [onError]);

  // Debounce fileData to prevent mounting 100 times per second during streaming
  const [debouncedFileData, setDebouncedFileData] = useState<FileData | null>(null);
  
  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedFileData(fileData);
    }, 1500); // 1.5s debounce ensures we only mount periodically during streaming
    return () => clearTimeout(timeout);
  }, [fileData]);

  const [filesMounted, setFilesMounted] = useState(false);

  // Mount files when debouncedFileData changes
  useEffect(() => {
    if (isBooting || !webcontainerInstance || !debouncedFileData?.files) return;
    
    let isStale = false;

    const mountFiles = async () => {
       const tree: any = {};
       
       // Convert fileData to WebContainer tree format
       for (const [path, fileObj] of Object.entries(debouncedFileData?.files || {})) {
          const parts = path.split("/").filter(Boolean);
          let currentLevel = tree;
          
          for (let i = 0; i < parts.length; i++) {
             const part = parts[i];
             if (i === parts.length - 1) {
                // File
                currentLevel[part] = {
                   file: { contents: (fileObj as any).code || "" }
                };
             } else {
                // Directory
                if (!currentLevel[part]) {
                   currentLevel[part] = { directory: {} };
                }
                currentLevel = currentLevel[part].directory;
             }
          }
       }
       // Inject package.json with the generated dependencies if it doesn't exist
       if (!tree["package.json"] && !tree["/package.json"]) {
          tree["package.json"] = {
             file: {
                contents: JSON.stringify({
                   name: "generated-app",
                   private: true,
                   dependencies: debouncedFileData?.dependencies || {}
                }, null, 2)
             }
          };
       }
       
       try {
          if (!isStale) {
             await webcontainerInstance!.mount(tree);
             setFilesMounted(true);
          }
       } catch (err) {
          console.error("Failed to mount files", err);
       }
    };
    
    mountFiles();

    return () => { isStale = true; };
  }, [debouncedFileData, isBooting]);

  // Track stable package.json hash to avoid restarting dev server multiple times
  const pkgJsonStr = debouncedFileData?.files?.["/package.json"]?.code || debouncedFileData?.files?.["package.json"]?.code || "";
  const [stablePkgHash, setStablePkgHash] = useState("");
  const [startScript, setStartScript] = useState("start");

  useEffect(() => {
    try {
      if (pkgJsonStr) {
        const parsed = JSON.parse(pkgJsonStr);
        const hash = JSON.stringify({ 
           deps: parsed.dependencies, 
           devDeps: parsed.devDependencies, 
           scripts: parsed.scripts 
        });
        if (hash !== stablePkgHash) {
           setStablePkgHash(hash);
           if (parsed.scripts?.dev) {
              setStartScript("dev");
           }
        }
      }
    } catch {
       // Ignore parse errors (mid-stream JSON)
    }
  }, [pkgJsonStr]);

  // Run install and dev
  useEffect(() => {
    if (isBooting || !webcontainerInstance || !filesMounted) return;
    
    // We only care if the stable package.json hash changes.
    // However, we want to run at least once when files are mounted initially.
    
    let installProcess: any = null;
    let devProcess: any = null;
    let isStale = false;
    
    // Clear URL to show loader while installing/restarting
    setUrl(null);

    const run = async () => {
       const term = xtermRef.current!;
       if (isStale) return;
       
       term.write("\\r\\nRunning npm install...\\r\\n");
       installProcess = await webcontainerInstance!.spawn("npm", ["install"]);
       
       installProcess.output.pipeTo(new WritableStream({
          write(data) {
             if (!isStale) term.write(data);
          }
       }));
       
       const installExitCode = await installProcess.exit;
       if (isStale) return;
       
       if (installExitCode !== 0) {
          term.write(\`\\r\\nnpm install failed with code \${installExitCode}\\r\\n\`);
          return;
       }
       
       if (isStale) return;
       term.write(\`\\r\\nRunning npm run \${startScript}...\\r\\n\`);
       devProcess = await webcontainerInstance!.spawn("npm", ["run", startScript]);
       
       devProcess.output.pipeTo(new WritableStream({
          write(data) {
             if (!isStale) term.write(data);
          }
       }));
    };
    
    run();
    
    return () => {
       isStale = true;
       if (devProcess) devProcess.kill();
       if (installProcess) installProcess.kill();
    };
  }, [isBooting, filesMounted, stablePkgHash, startScript]);

  return (
    <div className="flex flex-col h-full w-full bg-black">
       {url ? (
          <div className="flex-1 relative bg-white">
             <iframe 
                ref={iframeRef}
                src={url}
                className="w-full h-full border-0"
                title="Preview"
                allow="cross-origin-isolated"
             />
          </div>
       ) : (
          <div className="flex-1 flex items-center justify-center text-white/50 bg-[#1e1e1e]">
             {isBooting ? (
                <div className="flex items-center gap-2">
                   <Loader2 className="h-4 w-4 animate-spin" />
                   <span>Booting environment...</span>
                </div>
             ) : (
                <div className="flex items-center gap-2">
                   <Loader2 className="h-4 w-4 animate-spin" />
                   <span>Starting development server...</span>
                </div>
             )}
          </div>
       )}
       <div className="h-64 border-t border-white/10 p-2 overflow-hidden bg-[#1e1e1e]">
          <div ref={terminalRef} className="h-full w-full" />
       </div>
    </div>
  );
}
`;

fs.writeFileSync('/Users/admin/Desktop/ai-app-builder/components/PreviewPanel.tsx', fileContent);
console.log('Successfully wrote to PreviewPanel.tsx');
