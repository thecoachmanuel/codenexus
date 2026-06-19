"use client";

import { useEffect, useState } from "react";
import {
  SandpackProvider,
  SandpackLayout,
  SandpackPreview,
} from "@codesandbox/sandpack-react";
import type { FileData } from "@/types/workspace";

// Tailwind script we use in the editor so styling works without a build step
const TAILWIND_SCRIPT = `
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            border: "hsl(var(--border))",
            input: "hsl(var(--input))",
            ring: "hsl(var(--ring))",
            background: "hsl(var(--background))",
            foreground: "hsl(var(--foreground))",
            primary: {
              DEFAULT: "hsl(var(--primary))",
              foreground: "hsl(var(--primary-foreground))",
            },
            secondary: {
              DEFAULT: "hsl(var(--secondary))",
              foreground: "hsl(var(--secondary-foreground))",
            },
          }
        }
      }
    }
  </script>
`;

interface PreviewClientProps {
  fileData: FileData;
  title: string;
  isProUser?: boolean;
}

export function PreviewClient({ fileData, title, isProUser = false }: PreviewClientProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    document.title = title;
  }, [title]);

  if (!mounted) return null;

  // Prepare files for Sandpack
  const sandpackFiles: Record<string, string> = {};
  
  if (fileData.files) {
    for (const [path, content] of Object.entries(fileData.files)) {
      sandpackFiles[path] = content.code;
    }
  }

  // Inject Tailwind into public/index.html if missing
  if (!sandpackFiles["/public/index.html"]) {
    sandpackFiles["/public/index.html"] = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0" />
    <title>${title}</title>
    ${TAILWIND_SCRIPT}
  </head>
  <body>
    <noscript>You need to enable JavaScript to run this app.</noscript>
    <div id="root"></div>
  </body>
</html>`;
  } else if (!sandpackFiles["/public/index.html"].includes("tailwindcss.com")) {
    sandpackFiles["/public/index.html"] = sandpackFiles["/public/index.html"].replace(
      "</head>",
      `  ${TAILWIND_SCRIPT}\n  </head>`
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden">
      <SandpackProvider
        template="react"
        theme="light"
        files={sandpackFiles}
        customSetup={{
          dependencies: {
            "lucide-react": "latest",
            "date-fns": "latest",
            recharts: "2.12.0",
            clsx: "latest",
            "tailwind-merge": "latest",
            ...(fileData.dependencies || {}),
          },
        }}
        options={{
          classes: {
            "sp-wrapper": "h-full w-full",
            "sp-layout": "h-full w-full !rounded-none !border-0",
            "sp-preview": "h-full w-full",
            "sp-preview-iframe": "h-full w-full",
            "sp-preview-container": "h-full w-full",
          },
        }}
      >
        <SandpackLayout>
          <SandpackPreview 
            showNavigator={false} 
            showRefreshButton={false} 
            showOpenInCodeSandbox={false}
          />
        </SandpackLayout>
      </SandpackProvider>

      {!isProUser && (
        <a
          href="https://codenexus.com" // Update to your actual main domain URL if different
          target="_blank"
          rel="noopener noreferrer"
          className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full border border-gray-200 bg-white/90 px-3 py-1.5 text-xs font-medium text-gray-600 shadow-lg backdrop-blur-md transition-transform hover:scale-105 hover:text-gray-900"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/c_logo_short.png"
            alt="Crevo AI"
            className="h-4 w-4 rounded-sm"
          />
          Made with Crevo AI
        </a>
      )}
    </div>
  );
}
