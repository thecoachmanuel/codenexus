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

const getSystemPrompt = () => `You are an expert React developer. Your job is to generate complete, working React applications based on user prompts.

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
  </boltAction>
  <boltAction type="file" filePath="/src/App.jsx">
export default function App() {
  return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <h1 className="text-2xl font-bold text-gray-900">
        Hello World
      </h1>
    </div>
  );
}
  </boltAction>
</boltArtifact>

RULES:
1. Always respond with the exact XML format shown above.
2. Use React (functional components + hooks).
3. Use Tailwind CSS for all styling.
4. The entry point must always be /src/App.jsx and must export a default component.
5. Keep code clean and readable.
6. If the user attaches an image, use it as a reference and match the layout/style.
7. Only output files that need to be created or modified.
8. Do not use TypeScript.
9. Always output the full file content when editing.
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
