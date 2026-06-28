"use client";

import { useState } from "react";
import { Palette, X, Type, Moon, Sun, ChevronRight, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getFileCode, patchTailwindConfigColor, patchTailwindConfigFont, patchIndexHtmlFont } from "@/lib/theme-utils";
import type { FileData } from "@/types/workspace";

interface VisualThemeEditorProps {
  fileData: FileData | null;
  onFilePatch: (patches: FileData) => void;
  isEditMode: boolean;
  onToggleEditMode: () => void;
}

const COLORS = [
  { name: "Indigo", value: "#4f46e5", bgClass: "bg-indigo-600" },
  { name: "Rose", value: "#e11d48", bgClass: "bg-rose-600" },
  { name: "Emerald", value: "#059669", bgClass: "bg-emerald-600" },
  { name: "Amber", value: "#d97706", bgClass: "bg-amber-600" },
  { name: "Sky", value: "#0284c7", bgClass: "bg-sky-600" },
  { name: "Violet", value: "#7c3aed", bgClass: "bg-violet-600" },
];

const FONTS = [
  "Inter",
  "Roboto",
  "Open Sans",
  "Montserrat",
  "Poppins",
  "Outfit",
  "Playfair Display"
];

export function VisualThemeEditor({ fileData, onFilePatch, isEditMode, onToggleEditMode }: VisualThemeEditorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeColor, setActiveColor] = useState<string | null>(null);
  const [activeFont, setActiveFont] = useState<string>("Inter");
  // const [isDark, setIsDark] = useState(false);

  const handleColorChange = (color: string) => {
    setActiveColor(color);
    if (!fileData) return;

    let tailwindCode = getFileCode(fileData, "/tailwind.config.js") || getFileCode(fileData, "/tailwind.config.ts");
    if (!tailwindCode) return;

    const patchedTailwind = patchTailwindConfigColor(tailwindCode, color);
    
    onFilePatch({
      ...fileData,
      files: {
        "/tailwind.config.js": { code: patchedTailwind }
      }
    });
  };

  const handleFontChange = (font: string) => {
    setActiveFont(font);
    if (!fileData) return;

    let tailwindCode = getFileCode(fileData, "/tailwind.config.js") || getFileCode(fileData, "/tailwind.config.ts");
    let indexHtmlCode = getFileCode(fileData, "/index.html") || getFileCode(fileData, "/public/index.html");

    const patches: Record<string, { code: string }> = {};

    if (tailwindCode) {
      patches["/tailwind.config.js"] = { code: patchTailwindConfigFont(tailwindCode, font) };
    }
    if (indexHtmlCode) {
      const path = getFileCode(fileData, "/index.html") ? "/index.html" : "/public/index.html";
      patches[path] = { code: patchIndexHtmlFont(indexHtmlCode, font) };
    }

    if (Object.keys(patches).length > 0) {
      onFilePatch({
        ...fileData,
        files: patches
      });
    }
  };

  // Toggle Edit mode directly handled by parent
  
  if (!isOpen) {
    return (
      <div className="absolute top-4 right-4 z-40">
        <Button
          variant="secondary"
          size="icon"
          onClick={() => setIsOpen(true)}
          className="rounded-full shadow-lg bg-white/10 hover:bg-white/20 text-white backdrop-blur-md border border-white/20 h-10 w-10"
          title="Open Theme Editor"
        >
          <Palette className="h-5 w-5" />
        </Button>
      </div>
    );
  }

  return (
    <div className="absolute top-4 right-4 z-40 w-64 bg-[#111] border border-white/10 rounded-xl shadow-2xl overflow-hidden flex flex-col text-sm text-white/90">
      <div className="flex items-center justify-between p-3 border-b border-white/10 bg-white/5">
        <div className="flex items-center gap-2 font-medium">
          <Palette className="h-4 w-4 text-violet-400" />
          Theme Editor
        </div>
        <button onClick={() => setIsOpen(false)} className="text-white/50 hover:text-white transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>
      
      <div className="p-4 flex flex-col gap-5 overflow-y-auto max-h-[70vh] [&::-webkit-scrollbar]:hidden">
        {/* Colors */}
        <div>
          <label className="text-xs text-white/50 font-medium uppercase tracking-wider mb-2 block">Primary Color</label>
          <div className="grid grid-cols-6 gap-2">
            {COLORS.map((c) => (
              <button
                key={c.name}
                onClick={() => handleColorChange(c.value)}
                className={`w-7 h-7 rounded-full ${c.bgClass} flex items-center justify-center transition-transform hover:scale-110 ${activeColor === c.value ? 'ring-2 ring-white ring-offset-2 ring-offset-[#111]' : ''}`}
                title={c.name}
              />
            ))}
          </div>
        </div>

        {/* Fonts */}
        <div>
          <label className="text-xs text-white/50 font-medium uppercase tracking-wider mb-2 block">Typography</label>
          <select 
            value={activeFont}
            onChange={(e) => handleFontChange(e.target.value)}
            className="w-full bg-[#1e1e1e] border border-white/10 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-violet-500 text-white/90 appearance-none"
          >
            {FONTS.map(f => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </div>

        {/* AI Click-to-Edit */}
        <div>
          <label className="text-xs text-white/50 font-medium uppercase tracking-wider mb-2 block">AI Click-to-Edit</label>
          <Button
            variant={isEditMode ? "default" : "secondary"}
            onClick={onToggleEditMode}
            className={`w-full text-xs h-8 ${isEditMode ? 'bg-violet-600 hover:bg-violet-700 text-white shadow-[0_0_12px_rgba(124,58,237,0.4)]' : 'bg-white/10 hover:bg-white/20 text-white/80'}`}
          >
            {isEditMode ? "Exit Edit Mode" : "Select Element to Edit"}
          </Button>
          <p className="text-[10px] text-white/40 mt-1.5 leading-tight">
            {isEditMode ? "Click any element in the preview to make AI changes to it." : "Enable this to visually select elements for AI editing."}
          </p>
        </div>
      </div>
    </div>
  );
}
