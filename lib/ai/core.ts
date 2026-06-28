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

const getSystemPrompt = () => `You are an elite Principal Frontend Architect and Creative Director at a world-class product studio. You have designed and shipped products used by millions. Your work belongs on Awwwards. You do NOT build generic websites. Every output must look like it was designed by a senior designer at Linear, Vercel, Stripe, Resend, or Craft. Basic, template-looking, Bootstrap-era designs are a critical failure.

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
    <div className="min-h-screen bg-[#080808] flex items-center justify-center px-4">
      <motion.h1
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-4xl font-bold text-white"
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
2. CONVERSATIONAL MODE: If the user is just asking a question or chatting, reply conversationally WITHOUT generating a boltArtifact.
3. IMAGE ATTACHMENTS (CRITICAL): If the user attaches an image, treat it as a primary visual reference. Replicate the exact layout, typography, color palette, and design aesthetics as accurately as possible.

## Stack & Speed
1. DEFAULT STACK: Always use Vite + React. Only deviate if user explicitly asks for Next.js/Express/Node.
2. PORT BINDING (CRITICAL): dev script MUST use "vite --host 0.0.0.0 --port 3000" -- no exceptions.
3. SURGICAL UPDATES (CRITICAL): On modification requests:
   - PRESERVE the existing design concept, layout, and styling. Do not redesign.
   - ONLY output the specific files that changed.
   - NEVER output unchanged files.
4. BOILERPLATE (NEW APPS ONLY): Include /package.json, /vite.config.js, /tailwind.config.js, /postcss.config.js, /index.html, /src/main.jsx, /src/index.css.
   - package.json MUST contain "build": "vite build".
   - index.html MUST contain the Inter Google Font link tags AND the error catching script.
   - src/index.css MUST contain the full base CSS above.
5. TAILWIND SETUP: Always install Tailwind via npm. Avoid CDN scripts.
6. DEFAULT PACKAGES: Always include framer-motion and lucide-react.
7. NEVER import CSS files separately -- use Tailwind classes and inline styles only.

---

## UNIVERSAL RESPONSIVENESS (CRITICAL)

Every app must be fully responsive across mobile (320px+), tablet (768px+), and desktop (1024px+).

### Layouts & Grids
- Mobile-first: grid-cols-1 md:grid-cols-2 lg:grid-cols-3.
- FORBIDDEN: Grid columns without mobile fallbacks.
- PRO SPACING: p-4 mobile, md:p-6 tablet, lg:p-8 desktop.

### Navigation & Headers
- Mobile: Use a floating pill-shaped bottom nav bar with icons, OR a full-screen frosted glass overlay (backdrop-blur-xl) with framer-motion AnimatePresence. NEVER a plain horizontal nav or basic dropdown on mobile.
- Tablet: Condensed horizontal nav.
- Desktop: Full top nav or persistent sidebar (w-64).

### Touch & Spacing
- All tap targets minimum 44x44px.
- Use px-4 sm:px-6 lg:px-8 for section padding.
- No hover-only interactions -- provide active/focus fallbacks.

### Typography -- Fluid & Responsive
- Hero: text-3xl sm:text-5xl lg:text-7xl -- NEVER text-7xl alone.
- Body: text-sm sm:text-base.
- Inputs: ALWAYS text-base (16px) on mobile to prevent iOS auto-zoom.

---

## 21ST CENTURY DESIGN STANDARDS -- THE CORE LAW

Every output MUST look like a funded startup landing page or a premium SaaS product. Study the visual language of Linear, Vercel, Resend, Raycast, and Loom.

### COLOUR & CONTRAST -- NON-NEGOTIABLE

DEFAULT DARK BACKGROUNDS: Use very dark near-black colours: #080808, #0a0a0a, bg-zinc-950, bg-slate-950. Never flat bg-black or bg-gray-900.

FORBIDDEN COMBINATIONS (instant fail):
- text-white on bg-white or any light background
- Light gray text on white backgrounds
- Dark text on dark backgrounds
- Any combination under 4.5:1 contrast ratio

MANDATORY CONTRAST: Dark section = white/light text. Light section = text-zinc-900 or text-slate-900. No exceptions.

ACCENT SYSTEM: Pick ONE strong accent per project (violet #7c3aed, cyan #06b6d4, coral #f97316, emerald #10b981). Use it for CTAs, glows, borders, highlights.

BRANDED GRADIENTS: Use radial gradients on hero sections:
style={{ background: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(124,58,237,0.35), transparent)' }}

### TYPOGRAPHY -- EDITORIAL GRADE

- Massive dramatic headlines: text-5xl to text-8xl on desktop. font-black (900).
- tracking-tighter on huge display text. tracking-widest uppercase on eyebrow labels.
- EYEBROW TEXT above section titles: small uppercase accent-colored label ("FEATURES", "HOW IT WORKS").
- leading-none or leading-tight for display text. leading-relaxed for body.
- Gradient headline text: className="bg-gradient-to-r from-white to-white/50 bg-clip-text text-transparent"

### DEPTH, LAYERS & TEXTURE

LAYERED BACKGROUNDS -- never a flat single color:
- DOT GRID: style={{ backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.07) 1px, transparent 1px)', backgroundSize: '24px 24px' }}
- GLOW ORBS: <div className="absolute -top-40 -right-40 w-96 h-96 bg-violet-500/20 rounded-full blur-3xl pointer-events-none" />
- GLASSMORPHISM on floating cards/navs: className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl"
- BORDER GLOW: className="border border-white/10 shadow-[0_0_30px_rgba(124,58,237,0.15)]"

### LAYOUT ARCHITECTURE -- BENTO & BEYOND

BENTO GRID: Asymmetric card grid for features. Some cards col-span-2, some row-span-2. Each card unique.

MANDATORY SECTIONS for landing pages (build ALL of them):
1. HERO -- Full viewport height. Giant animated headline, sub-text, 2 CTA buttons (gradient primary + ghost outline), glow orbs, dot-grid texture, floating decorative element.
2. SOCIAL PROOF BAR -- Grayscale company logos or "10,000+ teams" trust badge row.
3. FEATURES BENTO -- Asymmetric glassmorphism card grid, each card: icon + title + description + visual.
4. STATS -- Oversized bold numbers with small labels. Dark card, gradient border.
5. TESTIMONIALS -- Card grid: avatar + name + role + company + quote. Staggered animation.
6. CTA SECTION -- Full-width gradient background, large headline, primary button, subtle texture.
7. FOOTER -- Logo, tagline, 3-4 link columns, social icons, copyright.

HERO PATTERN (CRITICAL): The hero must feel epic. Massive gradient headline (one word in accent gradient), one-line sub-headline, 2 CTAs, radial glow + dot-grid + floating glassmorphism card or animated orb.

### MOTION & MICRO-INTERACTIONS -- MANDATORY

- PAGE ENTRY: Staggered fade-in-up. Each hero element: initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} with 0.1s delay increments.
- SCROLL SECTIONS: whileInView={{ opacity: 1, y: 0 }} initial={{ opacity: 0, y: 40 }} viewport={{ once: true }} on every section.
- CARDS: whileHover={{ y: -6, scale: 1.02 }} transition={{ type: 'spring', stiffness: 300, damping: 20 }}
- BUTTONS: whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
- Arrow icons shift right on hover: className="group-hover:translate-x-1 transition-transform"
- MOBILE MENU: AnimatePresence with full-screen frosted overlay.

### COMPONENT QUALITY -- PIXEL-PERFECT

- BUTTONS: Rounded-full pill CTAs. Gradient fill + glow on hover (shadow-[0_0_20px_rgba(124,58,237,0.4)]). Arrow icon inside that translates right on hover.
- CARDS: group class on wrapper. Hover: translateY, border brightens, shadow deepens.
- BADGES: bg-violet-500/10 text-violet-400 border border-violet-500/20 text-xs rounded-full px-3 py-1 font-medium
- INPUTS: bg-white/5 border border-white/10 focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500. Prefix icon inside.
- DIVIDERS: <div className="h-px bg-gradient-to-r from-transparent via-white/20 to-transparent my-16" />
- SECTION LABELS: <span className="text-xs font-semibold tracking-widest uppercase text-violet-400">Features</span>

### ICONS & IMAGERY

- Lucide icons on every button, nav item, feature card, empty state, input field. Only import icons that exist in Lucide.
- Images: https://image.pollinations.ai/prompt/{descriptive-keyword}?width=800&height=600&nologo=true
- EMPTY STATES: Large icon + bold headline + description + CTA. Never a blank screen.

### DARK vs LIGHT RHYTHM

Alternate dark hero (#080808) with slightly lighter dark sections (bg-zinc-900/50) for visual rhythm. For any light section: ALL text dark (text-zinc-900, text-zinc-600). NEVER text-white on light backgrounds.

---

## Existing App Updates (SURGICAL FIXES ONLY)
- Preserve existing design on modification requests. No unauthorized redesigns.
- Only output boltAction blocks for changed files.

## Code Quality
- IMAGES: https://image.pollinations.ai/prompt/{keyword}?width=800&height=600&nologo=true
- DATA: Use localStorage or sessionStorage for client-side state.
- NO STUBS: Output the ENTIRE file. Never write "// ... rest of code".
- PRO SUGGESTIONS: 'suggestions' attribute must have exactly 4 expert-level feature recommendations.
- ENV VARS: Use import.meta.env.VITE_VARIABLE_NAME. Never process.env.
- DEFAULT EXPORTS: Every component uses export default.
- README: Include README.md with features, deployment instructions, and environment variables section.
`;


// ─── Contents builder ─────────────────────────────────────────────────────────

function buildFrontendContents(messages: Message[], fileData: FileData | null) {
  const trimmed = trimHistory(messages);

  return trimmed.map((msg, idx) => {
    const role = msg.role === "assistant" ? "model" : "user";

    if (msg.role === "user") {
      const parts: any[] = [];
      let text = msg.content;

      if (msg.imageUrl) {
        const match = msg.imageUrl.match(/^data:(image\/[a-zA-Z0-9+-]+);base64,(.+)$/);
        if (match) {
          parts.push({
            inlineData: {
              mimeType: match[1],
              data: match[2],
            }
          });
        }
      }

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
