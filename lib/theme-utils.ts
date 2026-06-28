import type { FileData } from "@/types/workspace";

export function getFileCode(fileData: FileData | null, path: string): string | null {
  if (!fileData || !fileData.files) return null;
  const file = fileData.files[path] || fileData.files[path.replace(/^\//, '')];
  if (!file) return null;
  return typeof file.code === "string" ? file.code : null;
}

export function patchTailwindConfigColor(code: string, color: string): string {
  // A naive but effective AST-less patcher:
  // If we already added a theme primary color, replace it.
  if (code.includes("primary: { DEFAULT:")) {
    return code.replace(/primary:\s*\{\s*DEFAULT:\s*['"`][^'"`]+['"`]/g, `primary: { DEFAULT: '${color}'`);
  }
  
  // Otherwise, insert it into theme: { extend: { colors: { ... } } }
  // We'll look for extend: {
  if (code.includes("extend: {")) {
    return code.replace(/extend:\s*\{/, `extend: {\n      colors: {\n        primary: { DEFAULT: '${color}' },\n      },`);
  }
  
  // If no extend: {, look for theme: {
  if (code.includes("theme: {")) {
    return code.replace(/theme:\s*\{/, `theme: {\n    extend: {\n      colors: {\n        primary: { DEFAULT: '${color}' },\n      },\n    },`);
  }

  return code; // Unmodified if couldn't parse
}

export function patchTailwindConfigFont(code: string, fontName: string): string {
  if (code.includes("fontFamily: {")) {
    if (code.includes("sans: [")) {
      return code.replace(/sans:\s*\[['"`][^'"`]+['"`]/, `sans: ['"${fontName}"'`);
    }
    return code.replace(/fontFamily:\s*\{/, `fontFamily: {\n      sans: ['"${fontName}"', 'sans-serif'],`);
  }
  
  if (code.includes("extend: {")) {
    return code.replace(/extend:\s*\{/, `extend: {\n      fontFamily: {\n        sans: ['"${fontName}"', 'sans-serif'],\n      },`);
  }
  
  if (code.includes("theme: {")) {
    return code.replace(/theme:\s*\{/, `theme: {\n    extend: {\n      fontFamily: {\n        sans: ['"${fontName}"', 'sans-serif'],\n      },\n    },`);
  }

  return code;
}

export function patchIndexHtmlFont(code: string, fontName: string): string {
  const fontUrl = `https://fonts.googleapis.com/css2?family=${fontName.replace(/ /g, '+')}:wght@300;400;500;600;700&display=swap`;
  
  // If it already has a Google Font, replace it
  if (code.includes("fonts.googleapis.com/css2")) {
    return code.replace(/href="https:\/\/fonts\.googleapis\.com\/css2[^"]+"/g, `href="${fontUrl}"`);
  }

  // Otherwise, inject before </head>
  const linkTag = `<link href="${fontUrl}" rel="stylesheet" />`;
  if (code.includes("</head>")) {
    return code.replace("</head>", `  ${linkTag}\n  </head>`);
  }
  
  return code;
}

export function patchIndexCssDarkMode(code: string, isDark: boolean): string {
  // If we want to enforce dark mode, we could wrap things or set background-color, but it's simpler to rely on tailwind's dark: classes or Shadcn.
  // We can add a utility here if we needed to mutate CSS directly.
  return code; 
}
