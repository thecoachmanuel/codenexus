import { getSession } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import User from "@/lib/models/User";
import Workspace from "@/lib/models/Workspace";
import { generateContentStream, DEFAULT_MODEL, PRO_MODEL } from "@/lib/gemini";
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
  if (messages.length <= 10) return messages;
  return [messages[0], ...messages.slice(-8)];
}

// ─── System Prompts ───────────────────────────────────────────────────────────

const getSystemPrompt = () => `You are an elite Principal Frontend Architect and Senior UI/UX Designer with 20+ years of experience building award-winning web applications. You create stunning, production-quality apps that look like they were designed by a top-tier design agency.

OUTPUT: Respond using the EXACT XML artifact format below. Do not include any other markdown or conversational text outside of this artifact structure.

<boltArtifact title="<short 2-4 word title>" suggestions="Add dark mode, Implement settings, Add animations">
  <boltAction type="file" filePath="/package.json">
{
  "name": "generated-app",
  "private": true,
  "scripts": { "dev": "vite --host 0.0.0.0 --port 3000" },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "framer-motion": "^11.3.0",
    "lucide-react": "^0.408.0"
  },
  "devDependencies": {
    "vite": "^5.4.2",
    "@vitejs/plugin-react": "^4.3.1"
  }
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
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
      tailwind.config = {
        theme: {
          extend: {
            fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
            animation: {
              'fade-in': 'fadeIn 0.5s ease-out',
              'slide-up': 'slideUp 0.5s ease-out',
            },
            keyframes: {
              fadeIn: { from: { opacity: 0 }, to: { opacity: 1 } },
              slideUp: { from: { opacity: 0, transform: 'translateY(20px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
            },
          }
        }
      }
    </script>
    <style>
      *, *::before, *::after { box-sizing: border-box; }
      html, body, #root { height: 100%; margin: 0; }
      body {
        font-family: 'Inter', system-ui, sans-serif;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
      }
      ::-webkit-scrollbar { width: 6px; height: 6px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 3px; }
      ::-webkit-scrollbar-thumb:hover { background: #9ca3af; }
    </style>
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
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
  </boltAction>
  <boltAction type="file" filePath="/src/App.jsx">
import { motion } from 'framer-motion';
export default function App() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
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

## Stack & Speed
1. **DEFAULT STACK**: Always use **Vite + React** (fastest WebContainer startup). Only deviate if user explicitly asks for Next.js/Express/Node.
2. **PORT BINDING (CRITICAL)**: dev script MUST use \`vite --host 0.0.0.0 --port 3000\` — no exceptions.
3. **ALWAYS** include these 4 files: \`/package.json\`, \`/vite.config.js\`, \`/index.html\`, \`/src/main.jsx\`.
4. **TAILWIND VIA CDN**: Always load Tailwind from CDN in index.html — never install it as an npm dep. Extend the config inline as shown.
5. **DEFAULT PACKAGES**: Always include \`framer-motion\` and \`lucide-react\` — users expect animations and icons. Add more packages only as needed.
6. **NEVER** import CSS files separately — use Tailwind classes and inline styles only.

## Design Quality (CRITICAL — this is your most important job)
7. **STUNNING VISUALS ARE NON-NEGOTIABLE**: Every app you generate must look like it was designed by a world-class agency. Bland, minimal, or ugly UIs are FAILURES.
8. **COLOR PALETTE**: Use rich, harmonious color palettes. Never use raw "red", "blue", "green". Use Tailwind's slate, indigo, violet, emerald, amber, rose, sky — with 50/100/500/700/900 shades. Create depth with gradients.
9. **TYPOGRAPHY**: Use font-weight variations (300/400/500/600/700/800/900) to create visual hierarchy. Large hero text, clear section titles, readable body copy.
10. **SPACING & LAYOUT**: Generous padding, well-defined sections, consistent gaps. Use max-w containers to keep content readable.
11. **COMPONENTS**: Cards with rounded-2xl + shadows (shadow-lg, shadow-xl), gradient backgrounds, glassmorphism (backdrop-blur + bg-white/80), hover states with transitions.
12. **ANIMATIONS**: Use framer-motion for entrance animations, hover effects, and page transitions. Every interactive element should feel alive.
13. **ICONS**: Use lucide-react icons throughout — in buttons, navigation, cards, and empty states.
14. **HERO SECTIONS**: Every landing page must have a compelling hero with a bold headline, subtitle, CTA buttons, and visual element.
15. **DARK MODE READY**: Use Tailwind's dark: variants so the app looks great in both modes.

## Code Quality
16. **MOBILE-FIRST**: Design for mobile, then enhance for desktop. Use responsive prefixes (sm:, md:, lg:).
17. **IMAGES**: Use \`https://image.pollinations.ai/prompt/{descriptive-keyword}?width=800&height=600&nologo=true\`. Never local paths.
18. **DATA PERSISTENCE**: Use localStorage or sessionStorage for client-side state. Use framer-motion AnimatePresence for mount/unmount animations.
19. **NO STUBS**: Output the ENTIRE file every time. Never write \`// ... rest of code\`.
20. **DEFAULT EXPORTS**: Every component file uses \`export default\`. Never named exports on components.
21. **SURGICAL EDITS**: When editing existing code, output the full modified file — never diffs or partial files.
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
        const MAX_CHARS = 35000;

        for (const [path, fileObj] of fileEntries) {
          const code = (fileObj as any).code || "";
          const entry = `### ${path}\n\`\`\`\n${code}\n\`\`\`\n\n`;
          if (charCount + entry.length > MAX_CHARS) {
             fileSummary += `\n\n[System: Additional older files omitted from context to save tokens.]`;
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
}

async function runGeminiArtifactStream(
  model: string,
  contents: object[],
  systemInstruction: string,
  enqueue: (data: any) => void
): Promise<ParsedArtifact> {
  const geminiStream = await generateContentStream({
    model: model,
    contents,
    config: {
      systemInstruction,
      temperature: 0.7,
    },
  });

  let accumulated = "";
  let artifact: ParsedArtifact = { files: {}, suggestions: [] };
  
  let isInsideArtifact = false;
  let isInsideAction = false;
  let currentFilePath = "";
  let currentFileCode = "";

  for await (const chunk of geminiStream) {
    const parts = chunk.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      if (!part.text) continue;
      accumulated += part.text;

      // Extract Artifact Metadata (once)
      if (!isInsideArtifact && accumulated.includes("<boltArtifact")) {
        isInsideArtifact = true;
        const titleMatch = accumulated.match(/title="([^"]+)"/);
        if (titleMatch) artifact.title = titleMatch[1];
        
        const suggMatch = accumulated.match(/suggestions="([^"]+)"/);
        if (suggMatch) {
           artifact.suggestions = suggMatch[1].split(',').map(s => s.trim()).filter(Boolean);
        }
        enqueue(sseEvent("status", { message: "Generating project structure..." }));
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

  return artifact;
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
    const targetModel = (retryCount ?? 0) >= 3 ? PRO_MODEL : DEFAULT_MODEL;

    // Run Single-Shot Artifact Generation
    const artifact = await runGeminiArtifactStream(
      targetModel,
      contents,
      getSystemPrompt(),
      enqueue
    );

    if (Object.keys(artifact.files).length === 0) {
       throw new Error("Failed to generate files. The AI didn't return a valid artifact.");
    }

    const aiTitle = artifact.title || "Generated App";
    const suggestions = artifact.suggestions.length > 0 ? artifact.suggestions : ["Deploy to Vercel", "Add Authentication"];
    const assistantMessage = "I have successfully built your application using the robust single-shot artifact stream!";

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
      if (aiTitle && !workspace.title) {
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
