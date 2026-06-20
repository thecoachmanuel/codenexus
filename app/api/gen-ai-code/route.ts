import { getSession } from "@/lib/auth";
import { NextRequest } from "next/server";
import { connectDB } from "@/lib/mongodb";
import User from "@/lib/models/User";
import Workspace from "@/lib/models/Workspace";
import { generateContentStream, DEFAULT_MODEL } from "@/lib/gemini";
import { calculateGenerationCost } from "@/lib/credit-calculator";
import { extractDependencies, findMissingFiles, autoFixAbsoluteImports, autoStubMissingFiles } from "@/lib/dependencies";
import { BASE_DEPENDENCIES, VITE_REACT_BOILERPLATE } from "@/lib/constants";
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
      responseMimeType: "application/json",
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

const SYSTEM_PROMPT = `You are an expert React developer. Generate a complete, working React frontend application.

OUTPUT: Respond with a valid JSON object only — no markdown fences, no extra text.
{
  "assistantMessage": "<chat response or brief explanation of what you built/changed>",
  "title": "<short 2-4 word title>",
  "suggestions": [
    "Add a dark mode toggle",
    "Implement the settings page",
    "Add sample data to the table"
  ],
  "files": {
    "/App.js": { "code": "<full file content>" },
    "/components/Sidebar.js": { "code": "<full file content>" }
  }
}

RULES:
1. Use React functional components + hooks. NO TypeScript in generated files.
2. Use standard clean React architecture: put components in \`/src/components\`, pages in \`/src/pages\`, hooks in \`/src/hooks\`, and utils in \`/src/lib\`.
3. Entry point MUST be \`/src/App.jsx\` with a default export.
4. Use Tailwind CSS for all styling. Do NOT import "tailwindcss" or any CSS files directly. Tailwind is already loaded via CDN.
5. All imports must reference files you include or valid npm packages.
6. Keep code clean, readable, production-quality.
7. NEVER use local image paths. For images use: https://image.pollinations.ai/prompt/{keyword}?width=800&height=600&nologo=true or https://placehold.co/600x400/png
8. **DUAL-MODE DATABASE**: You must create a data abstraction layer (e.g. \`/lib/db.js\`). This layer MUST check if \`process.env.REACT_APP_MONGODB_DATA_API_KEY\` exists. If it does, use the MongoDB Atlas Data API (via \`fetch\`) to persist data to the user's real database. If it does NOT exist, fall back to simulating data with \`localStorage\`. Do NOT attempt to use \`mongoose\` or direct TCP MongoDB connections, as this is a purely browser-based React app.
9. **DEPLOYMENT**: ALWAYS include a \`/README.md\` detailing exactly how to run the app, AND a dedicated section on how to deploy this app to Vercel, including instructions on where to configure the \`REACT_APP_MONGODB_DATA_API_URL\`, \`REACT_APP_MONGODB_DATA_API_KEY\`, and \`REACT_APP_MONGODB_DATA_API_CLUSTER\` environment variables in the Vercel dashboard.
10. If the user is just chatting or asking a question, you can omit the "files" field entirely and just respond with "assistantMessage" and "suggestions".
11. **CRITICAL SPEED OPTIMIZATION**: When modifying existing code, output ONLY the files that you are actually changing or creating. You MUST omit all other files from the "files" object. Unchanged files are preserved automatically. Do not output unchanged files.
12. "suggestions" must be an array of exactly 3 specific, actionable short phrases the user could ask for next.
13. **MOBILE-FIRST & RESPONSIVE**: You MUST design the application to be highly responsive and mobile-first. All layouts, sidebars, navigation menus, and content grids MUST collapse and adapt gracefully to small screens (e.g., using Tailwind's sm:, md:, lg: prefixes). Mobile responsiveness is CRITICAL.
14. **LIGHT MODE DEFAULT**: Design the application in light mode by default (e.g., using white backgrounds and dark text) unless the user explicitly requests a dark mode theme.
15. **RICH AESTHETICS & UI/UX**: You MUST build premium, state-of-the-art designs. Use modern web design best practices (vibrant colors, glassmorphism, soft shadows, rounded corners). The user should be WOWED at first glance. If your app looks basic or simple, you have FAILED. Use \`framer-motion\` to add micro-interactions, page transitions, and hover effects. An interface that feels alive encourages interaction.
16. **TOKEN LIMIT WARNING**: You have a strict 8192 token limit. Keep your components clean and concise. DO NOT generate massive files that will get truncated.
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
        const fileSummary = Object.entries(fileData.files ?? {})
          .map(([path, { code }]) => {
            return `### ${path}\n\`\`\`\n${code}\n\`\`\``;
          })
          .join("\n\n");

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

        const contents = buildFrontendContents(messages, fileData);

        const rawJson = await runGeminiPass(
          contents,
          SYSTEM_PROMPT,
          (label) => enqueue(sseEvent("status", { message: label }))
        );

        const parsed = safeParseJSON<{
          assistantMessage: string;
          title?: string;
          suggestions?: string[];
          files?: Record<string, { code: string }>;
        }>(rawJson);

        if (!parsed) {
          enqueue(sseEvent("error", { message: "Generation failed due to output length limits. Please ask for a simpler app." }));
          controller.close();
          return;
        }

        const { assistantMessage, title: aiTitle, suggestions, files } = parsed;

        // ── Merge existing files with new files ────────────────────────────────

        // Automatically upgrade older workspaces by ensuring Vite core files are present
        const baseWorkspace: Record<string, { code: string }> = { 
          ...(fileData?.files ?? {}) 
        };
        
        // Force Vite configs
        if (VITE_REACT_BOILERPLATE["/vite.config.js"]) {
          baseWorkspace["/vite.config.js"] = VITE_REACT_BOILERPLATE["/vite.config.js"];
        }
        if (VITE_REACT_BOILERPLATE["/index.html"]) {
          baseWorkspace["/index.html"] = VITE_REACT_BOILERPLATE["/index.html"];
          // Remove old CRA public/index.html if it exists
          delete baseWorkspace["/public/index.html"];
        }
        if (VITE_REACT_BOILERPLATE["/src/index.jsx"]) {
          if (!baseWorkspace["/src/index.jsx"]) {
            baseWorkspace["/src/index.jsx"] = VITE_REACT_BOILERPLATE["/src/index.jsx"];
          }
          delete baseWorkspace["/index.js"];
        }
        if (VITE_REACT_BOILERPLATE["/package.json"]) {
          // If they had an old package.json, we must ensure it has Vite scripts and devDependencies
          const oldPkgStr = baseWorkspace["/package.json"]?.code;
          let mergedPkg = VITE_REACT_BOILERPLATE["/package.json"].code;
          if (oldPkgStr) {
            try {
              const oldPkg = JSON.parse(oldPkgStr);
              const newPkg = JSON.parse(mergedPkg);
              // Preserve their dependencies but override scripts and devDependencies with Vite's
              newPkg.dependencies = { ...newPkg.dependencies, ...(oldPkg.dependencies || {}) };
              mergedPkg = JSON.stringify(newPkg, null, 2);
            } catch {}
          }
          baseWorkspace["/package.json"] = { code: mergedPkg };
        }

        const normalizedFiles: Record<string, { code: string }> = { ...baseWorkspace };
        
        if (files) {
          for (const [key, value] of Object.entries(files)) {
            let path = key;
            if (!path.startsWith("/")) path = "/" + path;
            if (path.startsWith("/src/") && path.endsWith("App.js")) path = "/src/App.jsx";
            if (path === "/App.js" || path === "/App.jsx") path = "/src/App.jsx";
            
            // Clean markdown fences (e.g. ```jsx ... ```)
            let rawCode = value.code;
            if (typeof rawCode === "string") {
              rawCode = rawCode.replace(/^```[a-z]*\n/i, "").replace(/\n```$/i, "");
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
