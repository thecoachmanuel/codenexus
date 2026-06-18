import { getSession } from "@/lib/auth";
import { NextRequest } from "next/server";
import { connectDB } from "@/lib/mongodb";
import User from "@/lib/models/User";
import Workspace from "@/lib/models/Workspace";
import { generateContentStream, DEFAULT_MODEL } from "@/lib/gemini";
import { CREDIT_COST_PER_GENERATION } from "@/lib/constants";
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

// ─── npm validation ───────────────────────────────────────────────────────────

async function validateDependencies(
  deps: Record<string, string>
): Promise<Record<string, string>> {
  const valid: Record<string, string> = {};
  await Promise.all(
    Object.entries(deps).map(async ([pkg, version]) => {
      try {
        const res = await fetch(`https://registry.npmjs.org/${pkg}/latest`, {
          signal: AbortSignal.timeout(1500),
        });
        if (res.ok) valid[pkg] = version;
      } catch {
        // silently skip hallucinated packages
      }
    })
  );
  return valid;
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
      thinkingConfig: { includeThoughts: true },
      maxOutputTokens: 32768,
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
    try {
      let attempt = raw.trim();
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

// ─── System Prompts ───────────────────────────────────────────────────────────

const FRONTEND_SYSTEM_PROMPT = `You are an expert React developer. Generate a complete, working React frontend application.

OUTPUT: Respond with a valid JSON object only — no markdown fences, no extra text.
{
  "assistantMessage": "<brief explanation of what you built/changed>",
  "title": "<short 2-4 word title>",
  "needsBackend": <true if auth/db/APIs needed, false otherwise>,
  "files": {
    "/App.js": { "code": "<full file content>" },
    "/components/Sidebar.js": { "code": "<full file content>" }
  },
  "dependencies": {
    "some-package": "latest"
  }
}

RULES:
1. Use React functional components + hooks. NO TypeScript in generated files.
2. Use Tailwind CSS for all styling.
3. Entry point MUST be /App.js with a default export.
4. All imports must reference files you include or packages in "dependencies".
5. Do NOT include react, react-dom, tailwindcss in "dependencies".
6. When editing existing code, include ALL files (changed and unchanged).
7. Keep code clean, readable, production-quality.
8. NEVER use local image paths. For images use:
   - https://image.pollinations.ai/prompt/{keyword}?width=800&height=600&nologo=true
   - https://placehold.co/600x400/png
   - https://ui-avatars.com/api/?name=Name&background=random
9. ALWAYS include a /README.md describing the project and how to run it.
10. Set "needsBackend": true if the request implies auth, databases, saving/persisting data, CRUD operations, APIs, or admin dashboards.
11. If "needsBackend" is true, the frontend MUST simulate data with localStorage so the preview works without a server.

COMPLEXITY MANAGEMENT:
- If the app is large (many pages, complex UI), generate the CORE first:
  * /App.js with routing + layout/sidebar
  * 1-2 primary pages fully built
  * Remaining pages as placeholder stubs with a // TODO comment
- Include /IMPLEMENTATION_PLAN.md listing what was built and what remains.
- Tell the user in assistantMessage to use the chat/Improve button for remaining pages.`;

const BACKEND_SYSTEM_PROMPT = `You are an expert Node.js/Express/MongoDB backend developer.

A React frontend has already been built. Your job is to generate the corresponding REAL backend that the frontend would connect to in production.

OUTPUT: Respond with a valid JSON object only — no markdown fences, no extra text.
{
  "backendFiles": {
    "/server.js": { "code": "<full file content>" },
    "/models/User.js": { "code": "<full file content>" },
    "/routes/auth.js": { "code": "<full file content>" },
    "/middleware/auth.js": { "code": "<full file content>" },
    "/.env.example": { "code": "<full file content>" }
  }
}

RULES:
1. Generate a complete, production-ready Express + Mongoose backend.
2. Include: /server.js, /models/*.js, /routes/*.js, /middleware/*.js, /.env.example
3. Use JWT for authentication, bcryptjs for password hashing.
4. Use CORS and dotenv.
5. The data models and API routes must exactly match what the React frontend (using localStorage) simulates.
6. Always include /.env.example with all required environment variables.
7. Code must be clean, commented, and ready to deploy to Render or Railway.`;

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
        const fileSummary = Object.entries(fileData.files)
          .map(([path, { code }]) => {
            const preview = code.length > 3000 ? code.slice(0, 3000) + "\n  ... (truncated)" : code;
            return `// ${path}\n${preview}`;
          })
          .join("\n\n---\n\n");

        const backendNote = fileData.backendFiles && Object.keys(fileData.backendFiles).length > 0
          ? "\n\nExisting Backend Files: " + Object.keys(fileData.backendFiles).join(", ")
          : "";

        text += `\n\nCurrent project files:\n${fileSummary}${backendNote}\nDependencies: ${JSON.stringify(fileData.dependencies ?? {})}`;
      }

      parts.push({ text });
      return { role, parts };
    }

    return { role, parts: [{ text: msg.content }] };
  });
}

function buildBackendContents(userPrompt: string, frontendFiles: Record<string, { code: string }>) {
  // Only pass App.js and key component files to keep context lean
  const keyFiles = Object.entries(frontendFiles)
    .filter(([path]) => !path.endsWith(".md"))
    .slice(0, 8) // max 8 frontend files as context
    .map(([path, { code }]) => {
      const preview = code.length > 2000 ? code.slice(0, 2000) + "\n  ... (truncated)" : code;
      return `// ${path}\n${preview}`;
    })
    .join("\n\n---\n\n");

  return [
    {
      role: "user",
      parts: [
        {
          text: `User's original request: "${userPrompt}"\n\nFrontend files already generated:\n${keyFiles}\n\nNow generate the complete Express/MongoDB backend for this app.`,
        },
      ],
    },
  ];
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
  if (user.credits < CREDIT_COST_PER_GENERATION) {
    return Response.json({ message: "Insufficient credits" }, { status: 402 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (chunk: string) =>
        controller.enqueue(encoder.encode(chunk));

      try {
        // ── PASS 1: FRONTEND ──────────────────────────────────────────────────

        enqueue(sseEvent("status", { message: "Building frontend…" }));

        const frontendContents = buildFrontendContents(messages, fileData);

        const frontendRaw = await runGeminiPass(
          frontendContents,
          FRONTEND_SYSTEM_PROMPT,
          (label) => enqueue(sseEvent("status", { message: label }))
        );

        const frontendParsed = safeParseJSON<{
          assistantMessage: string;
          title?: string;
          needsBackend?: boolean;
          files: Record<string, { code: string }>;
          dependencies: Record<string, string>;
        }>(frontendRaw);

        if (!frontendParsed || !frontendParsed.files) {
          enqueue(sseEvent("error", { message: "Frontend generation failed. Please try again." }));
          controller.close();
          return;
        }

        const { assistantMessage, title: aiTitle, needsBackend, files, dependencies } = frontendParsed;

        // ── Normalize File Paths ──────────────────────────────────────────────

        const normalizedFiles: Record<string, { code: string }> = {};
        for (const [key, value] of Object.entries(files)) {
          let path = key;
          if (!path.startsWith("/")) path = "/" + path;
          if (path.startsWith("/src/") && path.endsWith("App.js")) path = "/App.js";
          normalizedFiles[path] = value;
        }

        // ── PASS 2: BACKEND (only if needed) ──────────────────────────────────

        let backendFiles: Record<string, { code: string }> | undefined = undefined;

        if (needsBackend) {
          enqueue(sseEvent("status", { message: "Building backend…" }));

          const userPrompt = messages[messages.length - 1].content;
          const backendContents = buildBackendContents(userPrompt, normalizedFiles);

          const backendRaw = await runGeminiPass(
            backendContents,
            BACKEND_SYSTEM_PROMPT,
            (label) => enqueue(sseEvent("status", { message: label }))
          );

          const backendParsed = safeParseJSON<{
            backendFiles: Record<string, { code: string }>;
          }>(backendRaw);

          if (backendParsed?.backendFiles) {
            backendFiles = backendParsed.backendFiles;
          }
        }

        // ── Validate npm packages ──────────────────────────────────────────────

        enqueue(sseEvent("status", { message: "Validating packages…" }));
        const validatedDeps = await validateDependencies(dependencies ?? {});

        const newFileData: FileData = {
          files: normalizedFiles,
          dependencies: validatedDeps,
          title: aiTitle,
          backendFiles,
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
          workspace = await Workspace.create({
            userId: userObjectId,
            title: aiTitle ?? lastUserMessage.content.slice(0, 80),
            messages: updatedMessages,
            fileData: newFileData,
          });
        }

        await User.findByIdAndUpdate(userId, {
          $inc: { credits: -CREDIT_COST_PER_GENERATION },
        });

        const updatedUser = await User.findById(userId).select("credits");

        enqueue(
          sseEvent("done", {
            workspaceId: workspace!._id.toString(),
            assistantMessage,
            fileData: newFileData,
            creditsRemaining:
              updatedUser?.credits ?? user.credits - CREDIT_COST_PER_GENERATION,
          })
        );
      } catch (err) {
        console.error("[gen-ai-code] stream error:", err);
        enqueue(
          sseEvent("error", {
            message: "Something went wrong. Please try again.",
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
