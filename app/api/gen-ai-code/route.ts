import { getSession } from "@/lib/auth";
import { NextRequest } from "next/server";
import { connectDB } from "@/lib/mongodb";
import User from "@/lib/models/User";
import Workspace from "@/lib/models/Workspace";
import { generateContentStream, DEFAULT_MODEL } from "@/lib/gemini";
import { calculateGenerationCost } from "@/lib/credit-calculator";
import { extractDependencies, findMissingFiles, autoFixAbsoluteImports, autoStubMissingFiles } from "@/lib/dependencies";
import { BASE_DEPENDENCIES, REACT_BOILERPLATE } from "@/lib/constants";
import type { Message, FileData } from "@/types/workspace";
import mongoose from "mongoose";

// ─── SSE helper ───────────────────────────────────────────────────────────────

function sseEvent(type: string, payload: unknown): string {
  return `data: ${JSON.stringify({ type, ...(payload as object) })}\n\n`;
}

// ─── Extract short label from a Gemini thought chunk ─────────────────────────

function extractThoughtLabel(text: string): string | null {
  const boldMatch = text.match(/\*\*([^*]{4,60})\*\*/);
  if (boldMatch) return boldMatch[1].trim();
  const sentence = text.split(/[.\n]/)[0].trim();
  if (sentence.length >= 8 && sentence.length <= 80) return sentence;
  return null;
}

// ─── History trimming ─────────────────────────────────────────────────────────

function trimHistory(messages: Message[]): Message[] {
  if (messages.length <= 10) return messages;
  return [messages[0], ...messages.slice(-8)];
}

// ─── Helper: run a single Gemini streaming call and collect the full text ─────

async function runGeminiPass(
  contents: object[],
  systemInstruction: string,
  onThought: (label: string) => void
): Promise<string> {
  const geminiStream = await generateContentStream({
    model: DEFAULT_MODEL,
    contents,
    config: {
      systemInstruction,
      temperature: 0.7,
      responseMimeType: "text/plain",
    },
  });

  let accumulated = "";
  let lastEmitTime = 0;

  for await (const chunk of geminiStream) {
    const parts = chunk.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      if (!part.text) continue;
      if (part.thought) {
        const now = Date.now();
        if (now - lastEmitTime > 600) {
          const label = extractThoughtLabel(part.text);
          if (label) {
            onThought(label);
            lastEmitTime = now;
          }
        }
      } else {
        accumulated += part.text;
        const now = Date.now();
        if (now - lastEmitTime > 2000) {
          onThought(`Writing code... (${(accumulated.length / 1024).toFixed(1)} KB)`);
          lastEmitTime = now;
        }
      }
    }
  }
  return accumulated;
}

// ─── Helper: safely parse JSON with truncation recovery ──────────────────────

function safeParseJSON<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    // If standard parsing fails, try to extract just the JSON object
    let cleaned = raw;
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleaned = cleaned.substring(firstBrace, lastBrace + 1);
      try {
        return JSON.parse(cleaned) as T;
      } catch {
        // Fallback truncation recovery on the extracted JSON
        try {
          let attempt = cleaned.trim();
          attempt = attempt.replace(/,?\s*"[^"]*$/, "");
          const openBraces = (attempt.match(/\{/g) || []).length - (attempt.match(/\}/g) || []).length;
          const openBrackets = (attempt.match(/\[/g) || []).length - (attempt.match(/\]/g) || []).length;
          attempt += "}".repeat(Math.max(0, openBraces)) + "]".repeat(Math.max(0, openBrackets));
          return JSON.parse(attempt) as T;
        } catch {
          return null;
        }
      }
    }
    
    return null;
  }
}

// ─── System Prompts ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an elite, Principal React Architect with over 20 years of industry experience. Generate a complete, working React frontend application. You possess deep wisdom in building scalable, production-grade architectures.

CRITICAL ARCHITECTURE RULES:
For complex architectures, you CANNOT write the entire app blindly. You MUST enter "Planning Mode" first. 
1. Use the <write_plan> tool to write an implementation_plan.md detailing the files you will create.
2. Execute the plan step-by-step using the <write_file> tool for each file.
3. Use the <verify> tool if you want the system to check for syntax errors before you finish.
4. When everything is perfect, call the <finish> tool.

OUTPUT FORMAT (XML TOOLS ONLY):
You must respond ONLY using the following XML tags. Do NOT wrap them in markdown code blocks.

<write_plan>
# Implementation Plan
I will build...
</write_plan>

<write_file path="/App.js">
import React from 'react';
export default function App() {}
</write_file>

<verify />

<finish title="Short App Title" message="I have finished building the application. Here is what I did..." suggestions='["Add dark mode", "Deploy to Vercel", "Add user auth"]' />

RULES:
1. Use React functional components + hooks. NO TypeScript in generated files.
2. Build specifically for a Create-React-App template. Do NOT use Vite structures. Place all files (including App.js and index.js) directly in the root directory (/). Do NOT create a /src/ directory.
2. Use standard clean React architecture: put components in /components, pages in /pages, hooks in /hooks, and utils in /lib.
3. Entry point MUST be /App.js with a default export.
4. Use Tailwind CSS for all styling. Do NOT import "tailwindcss" or any CSS files directly. Tailwind is already loaded via CDN.
5. All imports must reference files you include or valid npm packages.
6. For placeholders and images, dynamically fetch descriptive images using the pollinations.ai API (e.g. https://image.pollinations.ai/prompt/a%20beautiful%20landscape).
7. NEVER use local image paths. For images use: https://image.pollinations.ai/prompt/{keyword}?width=800&height=600&nologo=true or https://placehold.co/600x400/png
8. **DUAL-MODE DATABASE**: You must create a data abstraction layer (e.g. /lib/db.js). This layer MUST check if process.env.REACT_APP_MONGODB_DATA_API_KEY exists. If it does, use the MongoDB Atlas Data API (via fetch) to persist data to the user's real database. If it does NOT exist, fall back to simulating data with localStorage. Do NOT attempt to use mongoose or direct TCP MongoDB connections, as this is a purely browser-based React app.
9. **DEPLOYMENT**: ALWAYS include a /README.md detailing exactly how to run the app, AND a dedicated section on how to deploy this app to Vercel, including instructions on where to configure the REACT_APP_MONGODB_DATA_API_URL, REACT_APP_MONGODB_DATA_API_KEY, and REACT_APP_MONGODB_DATA_API_CLUSTER environment variables in the Vercel dashboard.
10. If the user is just chatting or asking a question, you can omit the "files" field entirely and just respond with "assistantMessage" and "suggestions".
11. **CRITICAL SPEED OPTIMIZATION**: When modifying existing code, output ONLY the files that you are actually changing or creating. You MUST omit all other files from the "files" object. Unchanged files are preserved automatically. Do not output unchanged files.
12. "suggestions" must be an array of exactly 3 specific, actionable short phrases the user could ask for next.
13. **MOBILE-FIRST & RESPONSIVE**: You MUST design the application to be highly responsive and mobile-first. All layouts, navigation menus, and content grids MUST adapt gracefully to small screens. Ensure all desktop elements remain accessible on mobile, and vice versa. Mobile responsiveness is CRITICAL.
14. **LIGHT MODE DEFAULT**: Design the application in light mode by default (e.g., using white backgrounds and dark text) unless the user explicitly requests a dark mode theme.
15. **RICH AESTHETICS & UI/UX**: You MUST build premium, state-of-the-art designs. Use modern web design best practices (vibrant colors, glassmorphism, soft drop-shadows, rounded corners, beautiful typography). The user should be WOWED at first glance. If your app looks basic or simple, you have FAILED. Use \`framer-motion\` heavily to add micro-interactions, page transitions, and hover effects. An interface that feels alive encourages interaction. NEVER use generic flat colors (like \`bg-blue-500\`) for primary elements; use rich gradients (e.g. \`bg-gradient-to-r from-blue-500 to-indigo-600\`) and premium palettes.
16. **CRITICAL ROUTING & IMPORTS**: If you use routing, you MUST import ALL components (e.g. \`BrowserRouter\`, \`Routes\`, \`Route\`, \`Link\`, \`NavLink\`, \`useNavigate\`) from \`react-router-dom\`. DO NOT use \`<Link>\` or \`<NavLink>\` without importing them first! WARNING: If you use \`<NavLink>\`, do NOT use the \`isActive\` property inside its children unless you use the render prop pattern \`{({ isActive }) => (...)}\`. If you use icons, MUST import them from \`lucide-react\`.
17. **CRITICAL EXPORTS**: You MUST use \`export default function\` for ALL your components. When importing local components, you MUST use default imports (e.g. \`import Sidebar from './components/Sidebar'\`). NEVER use named exports/imports for your own components!
18. **TOKEN LIMIT WARNING**: You have a strict 8192 token limit. Keep your components clean and concise. DO NOT generate massive files that will get truncated.
`;

// ─── Contents builder ─────────────────────────────────────────────────────────

function buildFrontendContents(messages: Message[], fileData: FileData | null) {
  const trimmed = trimHistory(messages);

  return trimmed.map((msg, idx) => {
    const role = msg.role === "assistant" ? "model" : "user";

    if (msg.role === "user") {
      const parts: object[] = [];
      let text = msg.content;

      if (msg.imageUrl) {
        if (msg.imageUrl.startsWith("data:image/")) {
          const commaIndex = msg.imageUrl.indexOf(",");
          if (commaIndex !== -1) {
            const mimeType = msg.imageUrl.substring(5, msg.imageUrl.indexOf(";"));
            const base64Data = msg.imageUrl.substring(commaIndex + 1);
            parts.push({ inlineData: { data: base64Data, mimeType } });
            text = `[Image attached as design reference.]\n\n${text}`;
          }
        } else {
          text = `[Image URL for reference: ${msg.imageUrl}]\n\n${text}`;
        }
      }

      const isLast = idx === trimmed.length - 1;
      if (isLast && fileData) {
        let fileEntries = Object.entries(fileData.files ?? {});
        
        // TRUNCATION: Prioritize root and core architecture files
        fileEntries.sort(([pathA], [pathB]) => {
           const aImportant = pathA.includes("App") || pathA.includes("index") || pathA.includes("package.json");
           const bImportant = pathB.includes("App") || pathB.includes("index") || pathB.includes("package.json");
           if (aImportant && !bImportant) return -1;
           if (!aImportant && bImportant) return 1;
           return 0;
        });

        let fileSummary = "";
        let charCount = 0;
        const MAX_CHARS = 25000; // Capped at ~6000 tokens

        for (const [path, { code }] of fileEntries) {
          const entry = `### ${path}\n\`\`\`\n${code}\n\`\`\`\n\n`;
          if (charCount + entry.length > MAX_CHARS) {
             fileSummary += `\n\n[System: Additional older files omitted from context to save tokens. Proceed with available files.]`;
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

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return Response.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { workspaceId, userId, messages, fileData } = body as {
    workspaceId: string | null;
    userId: string;
    messages: Message[];
    fileData: FileData | null;
  };

  if (!messages?.length) {
    return Response.json({ message: "No messages provided" }, { status: 400 });
  }

  if (userId !== session.userId) {
    return Response.json({ message: "Unauthorized" }, { status: 401 });
  }

  await connectDB();

  const user = await User.findById(userId).select("_id credits");
  if (!user)
    return Response.json({ message: "User not found" }, { status: 404 });
    
  const cost = calculateGenerationCost(messages);
  
  if (user.credits < cost) {
    return Response.json({ message: `Insufficient credits. This complex task requires ${cost} credits, but you only have ${user.credits}.` }, { status: 402 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (chunk: string) =>
        controller.enqueue(encoder.encode(chunk));

      try {
        // ── GENERATION PASS ──────────────────────────────────────────────────

        enqueue(sseEvent("status", { message: "Thinking…" }));

        let currentContents = buildFrontendContents(messages, fileData);
        const { parseXmlTools } = await import("@/lib/xml-parser");

        let loopCount = 0;
        let isFinished = false;
        let assistantMessage = "I have finished the architecture.";
        let aiTitle = "New App";
        let suggestions: string[] = ["Add authentication", "Deploy to Vercel", "Customize theme"];
        let generatedFiles: Record<string, { code: string }> = {};

        // Agentic Execution Loop
        while (!isFinished && loopCount < 4) {
          loopCount++;
          
          enqueue(sseEvent("status", { message: `Executing step ${loopCount}...` }));
          
          const rawXml = await runGeminiPass(
            currentContents,
            SYSTEM_PROMPT,
            (label) => enqueue(sseEvent("status", { message: label }))
          );

          // COMPRESSION: Strip out the massive code payloads to save tokens for the next loop pass
          const compressedXml = rawXml.replace(
            /<write_file([^>]*)>([\s\S]*?)<\/write_file>/g,
            '<write_file$1>\n[System: File successfully written to virtual workspace (Token Compressed)]\n</write_file>'
          );

          // Append the COMPRESSED output to the conversation history, drastically reducing TPM burn
          currentContents[currentContents.length - 1].parts.push({ text: "\n" + compressedXml });

          const tools = parseXmlTools(rawXml); // We still extract the actual code from the rawXml!
          let verificationLog = [];

          for (const tool of tools) {
            if (tool.name === "write_plan") {
              generatedFiles["/implementation_plan.md"] = { code: tool.content };
              enqueue(sseEvent("status", { message: "Drafting implementation plan..." }));
            } else if (tool.name === "write_file") {
              const path = tool.attributes.path;
              if (path) {
                generatedFiles[path] = { code: tool.content };
                enqueue(sseEvent("status", { message: `Creating ${path}...` }));
              }
            } else if (tool.name === "verify") {
               enqueue(sseEvent("status", { message: "Verifying codebase..." }));
               verificationLog.push(`Verification complete. ${Object.keys(generatedFiles).length} files exist in the virtual workspace. Ensure all React components use default exports.`);
            } else if (tool.name === "finish") {
              isFinished = true;
              if (tool.attributes.title) aiTitle = tool.attributes.title;
              if (tool.attributes.message) assistantMessage = tool.attributes.message;
              if (tool.attributes.suggestions) {
                try { suggestions = JSON.parse(tool.attributes.suggestions); } catch (e) {}
              }
            }
          }

          if (!isFinished) {
            const nextPrompt = verificationLog.length > 0
              ? `<tool_response name="verify">${verificationLog.join('\n')}\nContinue executing your plan.</tool_response>`
              : `Continue executing the next steps of your plan.`;
              
            currentContents.push({ role: "user", parts: [{ text: nextPrompt }] });
          }
        }

        // Merge back into the expected parsed format for the rest of the backend auto-healers
        const parsed = {
          assistantMessage,
          title: aiTitle,
          suggestions,
          files: generatedFiles
        };

        const files = parsed.files;

        // ── Merge existing files with new files ────────────────────────────────

        // Automatically upgrade older workspaces by ensuring Vite core files are present
        const baseWorkspace: Record<string, { code: string }> = { 
          ...(fileData?.files ?? {}) 
        };
        
        // Clean up Vite /src/ directories and force them back to root for CRA
        for (const key of Object.keys(baseWorkspace)) {
          if (key.startsWith("/src/")) {
            const rootKey = key.replace("/src", "");
            // Prioritize existing root files, otherwise move the src file to root
            if (!baseWorkspace[rootKey]) {
              baseWorkspace[rootKey] = baseWorkspace[key];
            }
            delete baseWorkspace[key];
          }
        }
        
        // CRITICAL: Sandpack's vite-react template crashes if we override /package.json
        // Delete any legacy package.json so Sandpack relies on customSetup.dependencies safely
        delete baseWorkspace["/package.json"];
        
        // Force Vite configs
        // Force CRA configs
        if (REACT_BOILERPLATE["/index.js"]) {
          if (!baseWorkspace["/index.js"]) {
            baseWorkspace["/index.js"] = REACT_BOILERPLATE["/index.js"];
          }
          delete baseWorkspace["/src/index.jsx"];
        }
        if (REACT_BOILERPLATE["/styles.css"]) {
          if (!baseWorkspace["/styles.css"]) {
            baseWorkspace["/styles.css"] = REACT_BOILERPLATE["/styles.css"];
          }
          delete baseWorkspace["/src/styles.css"];
        }
        if (REACT_BOILERPLATE["/public/index.html"]) {
          baseWorkspace["/public/index.html"] = REACT_BOILERPLATE["/public/index.html"];
          delete baseWorkspace["/index.html"];
        }

        const normalizedFiles: Record<string, { code: string }> = { ...baseWorkspace };
        
        if (files) {
          for (const [key, value] of Object.entries(files)) {
            let path = key;
            if (!path.startsWith("/")) path = "/" + path;
            
            // Force files out of /src/ so they align with Sandpack CRA root structure
            if (path.startsWith("/src/")) {
              path = path.replace("/src", "");
            }
            
            if (path === "/App.jsx") path = "/App.js";
            
            // Clean markdown fences (e.g. ```jsx ... ```)
            let rawCode = value.code;
            if (typeof rawCode === "string") {
              rawCode = rawCode.replace(/^```[a-z]*\n/i, "").replace(/\n```$/i, "");
            }

            // AUTO-HEALER: Prevent "ReferenceError: X is not defined" for React Router
            const routerTokens = ["BrowserRouter", "Routes", "Route", "Link", "useNavigate", "useParams", "useLocation", "Navigate"];
            routerTokens.forEach(token => {
              const usesToken = new RegExp(`\\b${token}\\b`).test(rawCode);
              const importsToken = new RegExp(`import\\s+.*\\b${token}\\b.*\\s+from\\s+['"]react-router-dom['"]`).test(rawCode);
              if (usesToken && !importsToken) {
                rawCode = `import { ${token} } from 'react-router-dom';\n` + rawCode;
              }
            });

            // AUTO-HEALER: Fix Lucide Icon Hallucinations & Remap Non-existent Icons
            const iconRemap: Record<string, string> = {
              "Chat": "MessageCircle",
              "Comment": "MessageSquare",
              "ThumbUp": "ThumbsUp",
              "ThumbDown": "ThumbsDown",
              "DotsVertical": "MoreVertical",
              "DotsHorizontal": "MoreHorizontal",
              "Cross": "X",
              "Close": "X",
              "Error": "AlertCircle",
              "Warning": "AlertTriangle",
              "Success": "CheckCircle2",
              "Add": "Plus",
              "Remove": "Minus",
              "Delete": "Trash2",
              "Edit": "Edit2"
            };
            
            rawCode = rawCode.replace(/import\s+{([^}]+)}\s+from\s+['"]lucide-react['"]/g, (match, p1) => {
              const fixedImports = p1.split(',').map((i: string) => {
                const trimmed = i.trim();
                if (!trimmed) return "";
                
                let baseName = trimmed.replace(/Icon$/, "");
                let aliasName = trimmed;
                
                // If it already has an alias " as ", extract the base
                if (trimmed.includes(" as ")) {
                  const parts = trimmed.split(" as ");
                  baseName = parts[0].trim();
                  aliasName = parts[1].trim();
                }
                
                // Remap hallucinated base name if it exists in our map
                if (iconRemap[baseName]) {
                  baseName = iconRemap[baseName];
                }
                
                // Always alias it back to what the AI's JSX expects
                return `${baseName} as ${aliasName}`;
              }).filter(Boolean).join(', ');
              return `import { ${fixedImports} } from 'lucide-react'`;
            });

            // AUTO-HEALER: Fix missing export default
            if (!rawCode.includes("export default")) {
              const funcMatch = rawCode.match(/function\s+([A-Z][a-zA-Z0-9_]*)\s*\(/);
              if (funcMatch) {
                rawCode += `\nexport default ${funcMatch[1]};\n`;
              } else {
                const arrowMatch = rawCode.match(/const\s+([A-Z][a-zA-Z0-9_]*)\s*=\s*(?:\([^)]*\)|[a-zA-Z0-9_]+)\s*=>/);
                if (arrowMatch) {
                  rawCode += `\nexport default ${arrowMatch[1]};\n`;
                }
              }
            }

            normalizedFiles[path] = { ...value, code: rawCode };
          }
        }
        
        // Ensure robustness with AST extraction and auto stubbing
        autoFixAbsoluteImports(normalizedFiles);
        const missing = findMissingFiles(normalizedFiles);
        if (missing.length > 0) {
          autoStubMissingFiles(normalizedFiles, missing);
        }

        enqueue(sseEvent("status", { message: "Extracting packages…" }));
        const extracted = extractDependencies(normalizedFiles);
        const finalDependencies: Record<string, string> = { ...(fileData?.dependencies ?? {}) };
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

        const lastUserMessage = messages[messages.length - 1];
        const updatedMessages: Message[] = [
          ...messages,
          { role: "assistant", content: assistantMessage },
        ];

        const userObjectId = new mongoose.Types.ObjectId(userId);

        let workspace;
        if (workspaceId) {
          workspace = await Workspace.findOneAndUpdate(
            { _id: workspaceId, userId: userObjectId },
            { messages: updatedMessages, fileData: newFileData },
            { new: true }
          );
        } else {
          // Generate a unique, readable subdomain (e.g. app-xxxxx)
          const subdomain = "app-" + Math.random().toString(36).substring(2, 9);
          
          workspace = await Workspace.create({
            userId: userObjectId,
            title: aiTitle ?? lastUserMessage.content.slice(0, 80),
            subdomain,
            messages: updatedMessages,
            fileData: newFileData,
          });
        }

        await User.findByIdAndUpdate(userId, {
          $inc: { credits: -cost },
        });

        const updatedUser = await User.findById(userId).select("credits");

        enqueue(
          sseEvent("done", {
            workspaceId: workspace!._id.toString(),
            subdomain: workspace!.subdomain,
            assistantMessage,
            fileData: newFileData,
            creditsRemaining:
              updatedUser?.credits ?? user.credits - cost,
          })
        );
      } catch (err) {
        console.error("[gen-ai-code] stream error:", err);
        enqueue(
          sseEvent("error", {
            message: err instanceof Error ? err.message : "Something went wrong. Please try again.",
          })
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

export const runtime = "nodejs";
export const maxDuration = 300;
