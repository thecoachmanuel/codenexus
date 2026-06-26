import { getSession } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import User from "@/lib/models/User";
import Workspace from "@/lib/models/Workspace";
import { generateContentStream, getModels, rotateApiKey, getApiKeysCount } from "@/lib/gemini";
import { calculateGenerationCost } from "@/lib/credit-calculator";
import { extractDependencies, findMissingFiles, autoFixAbsoluteImports, autoStubMissingFiles } from "@/lib/dependencies";
import { BASE_DEPENDENCIES, FULLSTACK_BOILERPLATE } from "@/lib/constants";
import type { Message, FileData } from "@/types/workspace";
import mongoose from "mongoose";

// ─── SSE helper ───────────────────────────────────────────────────────────────

function sseEvent(type: string, payload: unknown) {
  return { type, ...(payload as object) };
}

// ─── History trimming ─────────────────────────────────────────────────────────

function trimHistory(messages: Message[]): Message[] {
  if (messages.length <= 3) return messages;
  return [messages[0], ...messages.slice(-2)];
}

// ─── System Prompts ───────────────────────────────────────────────────────────

const getSystemPrompt = () => `You are an elite Principal Frontend Architect and Senior UI/UX Designer with 20+ years of experience building award-winning web applications. You create stunning, production-quality apps that look like they were designed by a top-tier design agency.

OUTPUT: Respond using the EXACT XML artifact format below. Do not include any other markdown or conversational text outside of this artifact structure.

<boltArtifact title="<short 2-4 word title>" suggestions="Add dark mode, Implement settings, Add animations">
  <boltAction type="file" filePath="/package.json">
{
  "name": "generated-app",
  "private": true,
  "scripts": {
    "dev": "vite --host 0.0.0.0 --port 3000",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "framer-motion": "^11.3.0",
    "lucide-react": "^0.408.0"
  },
  "devDependencies": {
    "vite": "^5.4.2",
    "@vitejs/plugin-react": "^4.3.1",
    "tailwindcss": "^3.4.10",
    "postcss": "^8.4.41",
    "autoprefixer": "^10.4.20"
  }
}
  </boltAction>
  <boltAction type="file" filePath="/tailwind.config.js">
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: { extend: {} },
  plugins: [],
}
  </boltAction>
  <boltAction type="file" filePath="/postcss.config.js">
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
  </boltAction>
  <boltAction type="file" filePath="/vite.config.js">
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()] });
  </boltAction>
  <boltAction type="file" filePath="/index.html">
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>App</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
    <script>
      window.onerror = function(message, source, lineno, colno, error) {
        window.parent.postMessage({ type: 'preview_error', message: message + '\\n  at ' + source + ':' + lineno + ':' + colno }, '*');
      };
      window.addEventListener('unhandledrejection', function(event) {
        window.parent.postMessage({ type: 'preview_error', message: 'Unhandled Rejection: ' + (event.reason?.message || event.reason) }, '*');
      });
    </script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
  </boltAction>
  <boltAction type="file" filePath="/src/main.jsx">
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
  </boltAction>
  <boltAction type="file" filePath="/src/index.css">
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  *, *::before, *::after { box-sizing: border-box; }
  html {
    font-family: 'Inter', system-ui, -apple-system, sans-serif;
    -webkit-text-size-adjust: 100%;
    scroll-behavior: smooth;
  }
  body {
    margin: 0;
    padding: 0;
    min-height: 100dvh;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  img, video { max-width: 100%; height: auto; display: block; }
  button, a { min-height: 44px; min-width: 44px; }
}
  </boltAction>
  <boltAction type="file" filePath="/src/App.jsx">
import { motion } from 'framer-motion';

export default function App() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center px-4">
      <motion.h1
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-4xl font-bold text-slate-800"
      >
        Hello World
      </motion.h1>
    </div>
  );
}
  </boltAction>
</boltArtifact>

RULES:

## Communication & Chat
1. DYNAMIC SUMMARIES: When you build or update an app, ALWAYS provide a 2-4 sentence conversational summary outside of the artifact tags explaining what you built or fixed.
2. CONVERSATIONAL MODE: If the user is just asking a question or chatting, reply conversationally WITHOUT generating a boltArtifact. You do not have to write code for every message.

## Stack & Speed
1. DEFAULT STACK: Always use Vite + React (fastest WebContainer startup). Only deviate if user explicitly asks for Next.js/Express/Node.
2. PORT BINDING (CRITICAL): dev script MUST use "vite --host 0.0.0.0 --port 3000" — no exceptions.
3. SURGICAL UPDATES (CRITICAL): If the user asks for a modification, feature, or bug fix on an existing app:
   - YOU MUST PRESERVE THE EXISTING DESIGN CONCEPT, LAYOUT, AND STYLING. Do not hallucinate a totally new app or randomly redesign the UI.
   - ONLY output the specific files that changed (e.g., if you only changed App.jsx, ONLY output App.jsx).
   - NEVER output files that did not change (do NOT output package.json, index.html, index.css etc unless you explicitly modified them).
4. BOILERPLATE (NEW APPS ONLY): When generating a completely new app, you MUST include: /package.json, /vite.config.js, /tailwind.config.js, /postcss.config.js, /index.html, /src/main.jsx, /src/index.css.
   - package.json MUST contain "build": "vite build" so Vercel deployments succeed.
   - index.html MUST contain the Inter Google Font link tags AND the error catching script in the head.
   - src/index.css MUST contain the full base CSS shown above (Inter font-family, box-sizing reset, 44px min touch targets, etc.).
   Do not include these core files when doing an update unless requested.
5. TAILWIND SETUP: Always install Tailwind via npm and use postcss.config.js and src/index.css. Avoid CDN scripts.
6. DEFAULT PACKAGES: Always include framer-motion and lucide-react. Add more packages only as needed.
7. NEVER import CSS files separately — use Tailwind classes and inline styles only.

---

## UNIVERSAL RESPONSIVENESS & PRO DESIGN (CRITICAL)

Every single app you generate MUST follow standard professional UI design patterns and be fully responsive across mobile (320px+), tablet (768px+), and desktop (1024px+). Failing to properly implement breakpoints is your most critical failure mode.

### Layouts & Grids (Mobile -> Tablet -> Desktop)
- ALWAYS use a mobile-first approach. Start with single-column, then add columns at md: (tablet) and lg: (desktop).
- PRO PATTERN: grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4.
- FORBIDDEN: Using grid columns (e.g. grid-cols-3) without mobile/tablet fallbacks. This breaks the UI on smaller screens.
- PRO SPACING: Tight padding on mobile (p-4), medium on tablet (md:p-6), generous on desktop (lg:p-8).

### Navigation & Headers
- Mobile (< 768px): Use a clean hamburger menu (with slide-in drawer using framer-motion) OR a fixed bottom navigation bar. NEVER render a full horizontal nav on small screens.
- Tablet (768px - 1024px): Condensed horizontal nav or sidebar.
- Desktop (> 1024px): Full horizontal top nav or a persistent side navigation drawer (w-64).

### Component Scaling
- Sidebars: Hide completely on mobile (hidden md:flex), provide a drawer alternative.
- Tables: ALWAYS wrap in overflow-x-auto on mobile, or dynamically convert to a stacked card layout below the md: breakpoint.
- Hero Sections: Stack vertically and center-align on mobile (flex-col text-center), side-by-side with left-align on desktop (md:flex-row md:text-left).

### Touch & Spacing
- All tap targets (buttons, links, nav items) MUST be at minimum 44x44px (min-h-[44px] min-w-[44px]).
- Generous padding on mobile: px-4 py-3 minimum on interactive elements.
- No hover-only interactions — all hover effects must have an active/focus fallback for touch.
- Use gap-3 sm:gap-6 patterns — tighter on mobile, relaxed on desktop.
- Use px-4 sm:px-6 lg:px-8 for section horizontal padding.

### Typography — Fluid & Responsive
- Hero text: text-3xl sm:text-5xl lg:text-7xl — NEVER just text-7xl alone.
- Body: text-sm sm:text-base
- Subheadings: text-lg sm:text-2xl
- Inputs: ALWAYS text-base (16px) on mobile to prevent iOS auto-zoom.
- Line height: leading-tight for large display text, leading-relaxed for body.

### Images & Media
- All images: w-full h-auto object-cover with defined aspect ratios (aspect-video, aspect-square).
- Hero images: shorter on mobile (h-48 sm:h-64 md:h-96 lg:h-[32rem]).
- Use rounded-xl sm:rounded-2xl — slightly smaller radius on mobile.

### Mobile-Specific Patterns You MUST Use
- Cards: Full-width on mobile (w-full), grid on desktop.
- Modals/Dialogs: Full-screen on mobile (fixed inset-0 rounded-none), centered sheet on desktop (md:max-w-lg md:rounded-2xl).
- Forms: Full-width inputs (w-full), stacked labels above inputs, generous spacing between fields.
- Hero sections: text-center on mobile (text-center md:text-left), flex-col on mobile (flex-col md:flex-row).
- CTA buttons: Full-width on mobile (w-full md:w-auto).
- Sticky header: sticky top-0 z-50 with backdrop-blur-md for frosted glass effect.
- Mobile bottom CTA: For landing pages, add a fixed bottom-0 bar on mobile with the primary action.

---

## Design Quality (CRITICAL)

### Modern 2024/2025 Aesthetics (NON-NEGOTIABLE)
Every app must feel like a premium product from this decade.

1. TYPOGRAPHY: ALWAYS use the Inter font (loaded in index.html). Aggressive font weight contrasts: font-black or font-extrabold for headlines, font-semibold for subheadings, font-medium for UI labels, font-normal for body. Use tracking-tight for large text, tracking-wide uppercase for small labels/badges.

2. VIBRANT PRO COLOR PALETTES (CRITICAL):
   - DO NOT default to boring plain black and white themes unless explicitly requested. You MUST use professional, highly-vibrant color palettes.
   - Use rich, tailored hues for backgrounds (e.g., very dark slate 'bg-slate-950', deep midnight blue 'bg-blue-950', or warm off-white 'bg-stone-50').
   - Use complementary vibrant accent colors (e.g., 'emerald-500', 'rose-500', 'indigo-500', 'amber-500') to make the UI pop.
   - BUTTONS & CTAs: Follow strict standard UI design. Primary buttons MUST be highly visible with solid vibrant background colors (e.g., 'bg-indigo-600 hover:bg-indigo-700'), white text, comfortable padding ('px-6 py-2.5'), rounded corners, and smooth hover/active states.
   - Use subtle colored borders (e.g. 'border-indigo-500/20') and tinted shadows (e.g. 'shadow-indigo-500/10') to enhance depth instead of plain gray.

3. GLASSMORPHISM on cards/navs over gradient backgrounds:
   bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl shadow-xl

4. GRADIENT TEXT for hero headlines:
   bg-gradient-to-r from-violet-400 to-cyan-400 bg-clip-text text-transparent

5. MICRO-INTERACTIONS with framer-motion on EVERY interactive element:
   - Cards: whileHover={{ scale: 1.02, y: -4 }} transition={{ type: 'spring', stiffness: 300, damping: 20 }}
   - Buttons: whileTap={{ scale: 0.96 }}
   - Page entry: initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
   - Lists/grids: staggerChildren: 0.08 on container, each child gets opacity/y animation.
   - Mobile menu: AnimatePresence with x: "-100%" slide-in.

6. RICH LAYOUTS — never output a plain centered box:
   - Sticky/floating navbar with backdrop blur.
   - Hero with large gradient or background pattern, bold headline, subtext, 1-2 CTA buttons.
   - Feature grid: 3-4 cards with icon + title + description.
   - Stats bar: 3-4 numbers with labels.
   - Testimonials or social proof section.
   - Footer with site links, socials, copyright.

7. ICONS: Use lucide-react on every button, input (as prefix/suffix), nav item, empty state, feature card, and section header. Never leave UI elements iconless. STRICT REQUIREMENT: You MUST explicitly import every icon you use. DO NOT hallucinate icon names that do not exist in Lucide (e.g. NEVER use 'Barbell', use 'Dumbbell' instead). If you are unsure if an icon exists, use a safe generic fallback like 'Circle' or 'Check'.

8. EMPTY STATES: Always add illustrated empty states using icons + helpful text + a CTA. Never show a blank screen.

9. SHADCN-STYLE PRECISION: Crisp 1px borders (border-zinc-800 / border-gray-200), muted secondary text (text-zinc-400 / text-gray-500), comfortable padding (p-4 sm:p-6), consistent border-radius (rounded-xl or rounded-2xl throughout).

## Existing App Updates (CRITICAL - SURGICAL FIXES ONLY)
- DO NOT DESTROY THE FIRST VERSION: On modification requests, retain the existing design, layout, and logic. Never hallucinate a total redesign.
- SURGICAL PATCHING: Only output boltAction blocks for files that absolutely need to change.
- NO UNAUTHORIZED REDESIGNS: Only redesign if user explicitly says "redesign this".

## Code Quality
- IMAGES: Use https://image.pollinations.ai/prompt/{descriptive-keyword}?width=800&height=600&nologo=true. Never local paths or placeholder.
- DATA PERSISTENCE: Use localStorage or sessionStorage for client-side state.
- NO STUBS: Output the ENTIRE file every time. Never write // ... rest of code.
- ITERATIVE COMPLEXITY: Build a high-quality Core MVP first, avoiding massive generation in a single step.
- PRO SUGGESTIONS: The 'suggestions' attribute in the boltArtifact MUST contain exactly 3 spectacular, professional-developer-level feature recommendations to advance the specific project. Make each suggestion read like expert advice in a short, punchy sentence (e.g. "Implement JWT authentication to secure your user routes.").
- DEFAULT EXPORTS: Every component uses export default. Never named exports on components.
- README: ALWAYS include a README.md with features and deployment instructions.
`;


// ─── Contents builder ─────────────────────────────────────────────────────────

function buildFrontendContents(messages: Message[], fileData: FileData | null) {
  const trimmed = trimHistory(messages);

  return trimmed.map((msg, idx) => {
    const role = msg.role === "assistant" ? "model" : "user";

    if (msg.role === "user") {
      const parts: any[] = [];
      let text = msg.content;

      const isLast = idx === trimmed.length - 1;
      if (isLast && fileData) {
        let fileEntries = Object.entries(fileData.files ?? {});
        let fileSummary = "";
        let charCount = 0;
        const MAX_CHARS = 250000; // Increased to 250k chars (approx 60k tokens) so AI sees the full project context

        for (const [path, fileObj] of fileEntries) {
          const code = (fileObj as any).code || "";
          const entry = `### ${path}\n\`\`\`\n${code}\n\`\`\`\n\n`;
          if (charCount + entry.length > MAX_CHARS) {
             fileSummary += `\n\n[System: Additional older files omitted from context to save tokens. MAX_CHARS limit reached.]`;
             break;
          }
          fileSummary += entry;
          charCount += entry.length;
        }

        text += `\n\nCurrent project files:\n${fileSummary}\nDependencies: ${JSON.stringify(fileData.dependencies ?? {})}`;
      }

      parts.push({ text });
      return { role, parts };
    }

    return { role, parts: [{ text: msg.content }] };
  });
}

// ─── Streaming Artifact Parser ────────────────────────────────────────────────

interface ParsedArtifact {
  title?: string;
  suggestions: string[];
  files: Record<string, { code: string }>;
  assistantMessage?: string;
}

async function runGeminiArtifactStream(
  model: string,
  contents: object[],
  systemInstruction: string,
  enqueue: (data: any) => void
): Promise<ParsedArtifact> {
  let attempt = 0;
  const maxAttempts = Math.max(getApiKeysCount() * 3, 10);
  
  let artifact: ParsedArtifact = { files: {}, suggestions: [] };
  let previouslyCompletedFiles = new Set<string>();

  while (attempt < maxAttempts) {
    let geminiStream;
    let dynamicContents = [...contents];

    if (previouslyCompletedFiles.size > 0) {
      const skipMessage = `[SYSTEM EXCEPTION]: Your previous generation was interrupted by a network error. You already successfully generated the following files: ${Array.from(previouslyCompletedFiles).join(", ")}. Do NOT generate these files again. Output a new <boltArtifact> containing ONLY the remaining files needed to complete the user's request.`;
      
      const lastMessage = dynamicContents[dynamicContents.length - 1] as any;
      if (lastMessage && lastMessage.parts && lastMessage.parts.length > 0) {
         dynamicContents[dynamicContents.length - 1] = {
           ...lastMessage,
           parts: [...lastMessage.parts]
         };
         (dynamicContents[dynamicContents.length - 1] as any).parts[0] = {
           text: (dynamicContents[dynamicContents.length - 1] as any).parts[0].text + "\n\n" + skipMessage
         };
      }
    }

    let accumulated = "";
    let fullResponse = "";
    
    let isInsideArtifact = false;
    let isInsideAction = false;
    let currentFilePath = "";
    let currentFileCode = "";

    try {
      geminiStream = await generateContentStream({
        model: model,
        contents: dynamicContents,
        config: {
          systemInstruction,
          temperature: 0.7,
        },
      });

      for await (const chunk of geminiStream) {
        const parts = chunk.candidates?.[0]?.content?.parts ?? [];
        for (const part of parts) {
          if (!part.text) continue;
          accumulated += part.text;
          fullResponse += part.text;

          // Extract Artifact Metadata
          if (!isInsideArtifact && accumulated.includes("<boltArtifact")) {
            isInsideArtifact = true;
            enqueue(sseEvent("status", { message: "Generating project structure..." }));
          }

          if (isInsideArtifact && !artifact.title) {
            const titleMatch = accumulated.match(/<boltArtifact[^>]*title="([^"]+)"/);
            if (titleMatch) {
              const extractedTitle = titleMatch[1];
              // Filter out the literal placeholder if the AI forgets to replace it
              if (!extractedTitle.includes("<short") && !extractedTitle.includes("word title>")) {
                artifact.title = extractedTitle;
              } else {
                artifact.title = "Generated App"; // Fallback to prevent placeholder text
              }
            }
          }

          if (isInsideArtifact && artifact.suggestions.length === 0) {
            const suggMatch = accumulated.match(/<boltArtifact[^>]*suggestions="([^"]+)"/);
            if (suggMatch) {
               artifact.suggestions = suggMatch[1].split(',').map(s => s.trim()).filter(Boolean);
            }
          }

          // Check for action open
          if (isInsideArtifact && !isInsideAction) {
            const actionMatch = accumulated.match(/<boltAction[^>]*filePath="([^"]+)"[^>]*>/);
            if (actionMatch) {
              isInsideAction = true;
              currentFilePath = actionMatch[1];
              currentFileCode = "";
              // Clear everything before and including the opening tag
              accumulated = accumulated.substring(accumulated.indexOf(actionMatch[0]) + actionMatch[0].length);
              enqueue(sseEvent("status", { message: `Writing ${currentFilePath}...` }));
            }
          }

          // Check for action close
          if (isInsideAction) {
            const closeIdx = accumulated.indexOf("</boltAction>");
            if (closeIdx !== -1) {
              currentFileCode += accumulated.substring(0, closeIdx);
              
              let code = currentFileCode.trim();
              if (code.startsWith("```")) {
                 code = code.replace(/^```[a-z]*\n/i, "");
                 if (code.endsWith("```")) code = code.substring(0, code.length - 3).trim();
              }

              artifact.files[currentFilePath] = { code };
              previouslyCompletedFiles.add(currentFilePath);
              
              let normalizedPath = currentFilePath;
              if (!normalizedPath.startsWith("/")) normalizedPath = "/" + normalizedPath;
              enqueue(sseEvent("file_patch", { path: normalizedPath, code }));

              isInsideAction = false;
              currentFilePath = "";
              currentFileCode = "";
              accumulated = accumulated.substring(closeIdx + "</boltAction>".length);
            } else {
              // Send all but the last 20 chars to currentFileCode to avoid splitting </boltAction>
              if (accumulated.length > 20) {
                const flush = accumulated.substring(0, accumulated.length - 20);
                currentFileCode += flush;
                accumulated = accumulated.substring(accumulated.length - 20);
                
                // emit partial file update for live UI typing
                let partialCode = currentFileCode;
                if (partialCode.startsWith("```")) {
                   partialCode = partialCode.replace(/^```[a-z]*\n/i, "");
                }
                let normalizedPath = currentFilePath;
                if (!normalizedPath.startsWith("/")) normalizedPath = "/" + normalizedPath;
                enqueue(sseEvent("file_patch", { path: normalizedPath, code: partialCode }));
              }
            }
          }
        }
      }

      if (!artifact.assistantMessage) {
        artifact.assistantMessage = fullResponse.replace(/<boltArtifact[\s\S]*?<\/boltArtifact>/g, '').trim();
      }
      return artifact;
      
    } catch (err: any) {
      attempt++;
      const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
      
      const isTransientOrRateLimit = 
        msg.includes("429") || 
        msg.includes("503") || 
        msg.includes("unavailable") || 
        msg.includes("rate limit") || 
        msg.includes("quota") ||
        msg.includes("overloaded") ||
        msg.includes("fetch failed") ||
        msg.includes("stream aborted");

      if (isTransientOrRateLimit && attempt < maxAttempts) {
        rotateApiKey();
        enqueue(sseEvent("status", { message: "Processing..." }));
        await new Promise(r => setTimeout(r, 2000));
        enqueue(sseEvent("status", { message: "Resuming generation..." }));
        continue;
      }
      
      throw err;
    }
  }
  
  throw new Error("Failed to complete generation stream after maximum retry attempts.");
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function generateWorkspaceTask(
  { workspaceId, userId, messages, fileData, retryCount }: { workspaceId: string | null; userId: string; messages: Message[]; fileData: FileData | null; retryCount?: number },
  externalEnqueue: (type: string, payload: any) => void
) {
  await connectDB();

  const user = await User.findById(userId).select("_id credits");
  if (!user) throw new Error("User not found");
    
  const cost = calculateGenerationCost(messages);
  if (user.credits < cost) {
    throw new Error(`Insufficient credits. This complex task requires ${cost} credits, but you only have ${user.credits}.`);
  }

  const enqueue = (data: any) => {
    const { type, ...payload } = data;
    externalEnqueue(type, payload);
  };

  try {
    enqueue(sseEvent("status", { message: "Thinking…" }));

    const contents = buildFrontendContents(messages, fileData);
    const models = await getModels();
    let targetModel = models.defaultModel;
    if ((retryCount ?? 0) >= 2) {
      targetModel = models.proModel;
      enqueue(sseEvent("status", { message: "Escalating to Pro model for advanced repair…" }));
    }

    // Run Single-Shot Artifact Generation
    const artifact = await runGeminiArtifactStream(
      targetModel,
      contents,
      getSystemPrompt(),
      enqueue
    );

    if (Object.keys(artifact.files).length === 0 && !artifact.assistantMessage) {
       throw new Error("Failed to generate response. The AI returned an empty output.");
    }

    const aiTitle = artifact.title || "Generated App";
    const suggestions = artifact.suggestions.length > 0 ? artifact.suggestions : ["Deploy to Vercel", "Add Authentication"];
    const assistantMessage = artifact.assistantMessage && artifact.assistantMessage.length > 5
      ? artifact.assistantMessage
      : "I have updated your application files as requested.";

    // ── Merge existing files with new files ────────────────────────────────
    const baseWorkspace: Record<string, { code: string }> = { ...(fileData?.files ?? {}) };
    const normalizedFiles: Record<string, { code: string }> = { ...baseWorkspace };
    
    for (const [key, value] of Object.entries(artifact.files)) {
      let path = key;
      if (!path.startsWith("/")) path = "/" + path;
      normalizedFiles[path] = value;
    }
    
    // Ensure robustness with AST extraction and auto stubbing
    autoFixAbsoluteImports(normalizedFiles);
    const missing = findMissingFiles(normalizedFiles);
    if (missing.length > 0) {
      autoStubMissingFiles(normalizedFiles, missing);
    }

    enqueue(sseEvent("status", { message: "Extracting packages…" }));
    let finalDependencies: Record<string, string> = { ...(fileData?.dependencies ?? {}) };
    
    // Check if AI generated a package.json and extract deps from it
    const pkgJsonStr = normalizedFiles["/package.json"]?.code;
    if (pkgJsonStr) {
       try {
          const pkg = JSON.parse(pkgJsonStr);
          if (pkg.dependencies) {
             finalDependencies = { ...finalDependencies, ...pkg.dependencies };
          }
          if (pkg.devDependencies) {
             finalDependencies = { ...finalDependencies, ...pkg.devDependencies };
          }
       } catch(e) {}
    }

    const extracted = extractDependencies(normalizedFiles);
    extracted.forEach(pkg => {
      if (!finalDependencies[pkg] && !BASE_DEPENDENCIES[pkg]) {
        finalDependencies[pkg] = "latest";
      }
    });

    const newFileData: FileData = {
      files: normalizedFiles,
      dependencies: finalDependencies,
      title: aiTitle ?? fileData?.title,
      suggestions,
      envVars: fileData?.envVars,
    };

    // ── Upsert workspace + deduct credit ──────────────────────────────────
    enqueue(sseEvent("status", { message: "Saving…" }));

    const updatedMessages: Message[] = [
      ...messages,
      { role: "assistant", content: assistantMessage },
    ];

    const userObjectId = new mongoose.Types.ObjectId(userId);

    let workspace;
    if (workspaceId) {
      workspace = await Workspace.findOne({ _id: workspaceId, userId: userObjectId });
    }

    if (workspace) {
      workspace.messages = updatedMessages;
      workspace.fileData = newFileData;
      if (aiTitle && (!workspace.title || workspace.title === "Generating...")) {
        workspace.title = aiTitle;
      }
      await workspace.save();
    } else {
      const subdomain = "app-" + Math.random().toString(36).substring(2, 9);
      workspace = await Workspace.create({
        _id: workspaceId ? new mongoose.Types.ObjectId(workspaceId) : new mongoose.Types.ObjectId(),
        userId: userObjectId,
        title: aiTitle,
        subdomain,
        messages: updatedMessages,
        fileData: newFileData,
      });
    }

    if (!workspace) throw new Error("Failed to save workspace");

    // Deduct credits
    const updatedUser = await User.findOneAndUpdate({ _id: userObjectId }, { $inc: { credits: -cost } }, { new: true });

    enqueue(sseEvent("status", { message: "Complete!" }));
    enqueue(sseEvent("done", { 
      workspaceId: workspace._id.toString(),
      subdomain: workspace.subdomain,
      fileData: newFileData,
      assistantMessage: assistantMessage,
      creditsRemaining: updatedUser?.credits || 0
    }));

  } catch (error: any) {
    console.error("Workspace generation error:", error);
    enqueue(sseEvent("error", { message: error.message || "An error occurred during generation." }));
  }
}
