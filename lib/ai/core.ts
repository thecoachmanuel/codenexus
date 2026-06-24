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
    <!-- Catch unhandled errors and forward them to the IDE -->
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
  html {
    font-family: system-ui, sans-serif;
  }
}
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

## Communication & Chat
1. **DYNAMIC SUMMARIES**: When you build or update an app, ALWAYS provide a 2-4 sentence conversational summary outside of the \`<boltArtifact>\` tags explaining what you built or fixed.
2. **CONVERSATIONAL MODE**: If the user is just asking a question or chatting (and doesn't need any code changes), simply reply conversationally WITHOUT generating a \`<boltArtifact>\`. You do not have to write code for every message.

## Stack & Speed
1. **DEFAULT STACK**: Always use **Vite + React** (fastest WebContainer startup). Only deviate if user explicitly asks for Next.js/Express/Node.
2. **PORT BINDING (CRITICAL)**: dev script MUST use \`vite --host 0.0.0.0 --port 3000\` — no exceptions.
3. **SURGICAL UPDATES (CRITICAL)**: If the user asks for a modification or fix, **ONLY output the specific files that changed.** NEVER output files that did not change. Do NOT re-output package.json, index.html, etc., unless you are actively changing them.
4. **BOILERPLATE (NEW APPS ONLY)**: When generating a completely new app, you MUST include these core files: \`/package.json\`, \`/vite.config.js\`, \`/tailwind.config.js\`, \`/postcss.config.js\`, \`/index.html\`, \`/src/main.jsx\`, and \`/src/index.css\`. 
   - \`package.json\` MUST contain \`"build": "vite build"\` so Vercel deployments succeed.
   - \`index.html\` MUST contain an error catching script in the \`<head>\`: \`<script>window.onerror = function(m,s,l,c,e){window.parent.postMessage({type:'preview_error',message:m+'\\n at '+s+':'+l+':'+c},'*')};window.addEventListener('unhandledrejection',function(e){window.parent.postMessage({type:'preview_error',message:'Unhandled Rejection: '+(e.reason?.message||e.reason)},'*')});</script>\`
   Do not include these core files when doing an update unless requested.
5. **TAILWIND SETUP**: Always install Tailwind via npm and use \`postcss.config.js\` and \`src/index.css\`. Avoid CDN scripts as they fail in WebContainer isolated iframes and cause ugly previews.
6. **DEFAULT PACKAGES**: Always include \`framer-motion\` and \`lucide-react\` — users expect animations and icons. Add more packages only as needed.
7. **NEVER** import CSS files separately — use Tailwind classes and inline styles only.

## Design Quality (CRITICAL — this is your most important job)
7. **PRO-LEVEL AESTHETICS ARE NON-NEGOTIABLE**: When generating a NEW app, it must look like a premium, modern SaaS product or world-class agency site. Basic, bland, or "MVP-looking" UIs are UNACCEPTABLE.
7b. **PRESERVE EXISTING DESIGNS (CRITICAL)**: If the user asks you to modify, update, or fix an EXISTING app, you MUST strictly preserve the existing design concept, layout, and colors. Do NOT redesign the app or change the UI structure unless the user explicitly requests a redesign.
8. **SHADCN/UI & MODERN PATTERNS**: While you may not install the shadcn CLI, you MUST write Tailwind components that perfectly replicate the Shadcn UI aesthetic: clean lines, subtle borders (border-border), muted foregrounds for secondary text, and elegant spacing. Use Radix UI primitives if needed for complex accessible components.
9. **ADVANCED LAYOUTS**: Avoid generic centered boxes. Use Bento grids, sidebar dashboards, sticky headers, complex data tables with pagination, and sleek modal overlays.
10. **COLOR PALETTE & LIGHT MODE DEFAULT**: Implement beautiful, harmonious color palettes (e.g., Zinc/Slate for neutral, Violet/Indigo for primary). Default to designing **LIGHT MODE** applications. Do NOT implement dark mode unless the user explicitly requests it. Create depth with subtle shadows, elegant borders, and clean white/gray backgrounds.
11. **MICRO-INTERACTIONS & ANIMATIONS**: You MUST use \`framer-motion\` to make the app feel alive. Include page transition animations, stagger animations for list items, hover spring effects on cards and buttons, and loading skeletons instead of basic spinners.
12. **TYPOGRAPHY**: Use tracking-tight for headings, tracking-normal for body. Mix font weights (e.g., font-extrabold for heroes, font-medium for buttons) to create strict visual hierarchy.
13. **COMPLEX FEATURES**: Integrate advanced features out-of-the-box: toast notifications (e.g., using \`sonner\` or building a custom toast context), complex form validations, tooltips, dropdown menus, and interactive charts (e.g., using \`recharts\`).
14. **ICONS**: Use \`lucide-react\` extensively. Every button, menu item, and empty state should be accompanied by a beautiful, consistent icon.

## Code Quality
16. **MOBILE-FIRST**: Design for mobile, then enhance for desktop. Use responsive prefixes (sm:, md:, lg:).
17. **IMAGES**: Use \`https://image.pollinations.ai/prompt/{descriptive-keyword}?width=800&height=600&nologo=true\`. Never local paths.
18. **DATA PERSISTENCE**: Use localStorage or sessionStorage for client-side state. Use framer-motion AnimatePresence for mount/unmount animations.
19. **NO STUBS**: Output the ENTIRE file every time. Never write \`// ... rest of code\`.
20. **ITERATIVE COMPLEXITY**: If the user requests a massive, complex application, DO NOT try to build 20+ features in one shot. Build a fully functional, high-quality **Core Version (MVP)** first. Then, in your dynamic conversational summary, suggest 2-3 specific features the user can ask you to add next.
21. **DEFAULT EXPORTS**: Every component file uses \`export default\`. Never named exports on components.
22. **SURGICAL EDITS ONLY**: When fixing or updating an app, **do not rewrite the entire project**. Only output the \`<boltAction type="file">\` blocks for the specific files that you are modifying. Furthermore, inside those files, strictly maintain the existing component structure and styling. Do not hallucinate a new design.
23. **README**: ALWAYS include a \`README.md\` file containing details about the generated app, its features, and explicit instructions on how to deploy it (e.g. to Vercel or Netlify).
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
        const MAX_CHARS = 6000;

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
  
  while (attempt < maxAttempts) {
    let geminiStream;
    try {
      geminiStream = await generateContentStream({
        model: model,
        contents,
        config: {
          systemInstruction,
          temperature: 0.7,
        },
      });
    } catch (err: any) {
      throw err;
    }

    let accumulated = "";
    let fullResponse = "";
    let artifact: ParsedArtifact = { files: {}, suggestions: [] };
    
    let isInsideArtifact = false;
    let isInsideAction = false;
    let currentFilePath = "";
    let currentFileCode = "";

    try {
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

      artifact.assistantMessage = fullResponse.replace(/<boltArtifact[\s\S]*?<\/boltArtifact>/g, '').trim();
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
        enqueue(sseEvent("status", { message: "Gracefully rotating key..." }));
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
