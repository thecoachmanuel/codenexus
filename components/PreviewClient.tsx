"use client";

import { useEffect, useState } from "react";
import { PreviewPanel } from "@/components/PreviewPanel";
import type { FileData } from "@/types/workspace";
import { AlertTriangle } from "lucide-react";

interface PreviewClientProps {
  fileData: FileData;
  title: string;
  isProUser?: boolean;
}

export function PreviewClient({ fileData, title, isProUser = false }: PreviewClientProps) {
  const [mounted, setMounted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    document.title = title;
  }, [title]);

  if (!mounted) return null;

  return (
    <div className="relative h-full w-full bg-black overflow-hidden flex flex-col">
      <div className="flex-1 overflow-hidden">
         <PreviewPanel 
            fileData={fileData}
            onError={(err) => setError(err)}
            hideStatusBar={true}
         />
      </div>
      {error && (
         <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-red-950/90 text-white p-4 rounded-lg shadow-2xl border border-red-500/30 flex flex-col max-w-md">
            <div className="flex items-center gap-2 mb-2 text-red-400">
               <AlertTriangle className="w-5 h-5" />
               <h3 className="font-semibold">Preview Error</h3>
            </div>
            <p className="text-sm opacity-80 break-words">{error}</p>
         </div>
      )}

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
