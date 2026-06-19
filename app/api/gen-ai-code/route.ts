import { getSession } from "@/lib/auth";
import { NextRequest } from "next/server";
import { connectDB } from "@/lib/mongodb";
import User from "@/lib/models/User";
import Workspace from "@/lib/models/Workspace";
import { generateContentStream, DEFAULT_MODEL } from "@/lib/gemini";
import { calculateGenerationCost } from "@/lib/credit-calculator";
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
      // thinkingConfig: { includeThoughts: true }, // Flash does not support thinking
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
  },
  "dependencies": {
    "some-package": "latest"
  }
}

RULES:
1. Use React functional components + hooks. NO TypeScript in generated files.
2. Use standard clean React architecture: put components in \`/components\`, pages in \`/pages\`, hooks in \`/hooks\`, and utils in \`/lib\`.
3. Entry point MUST be \`/App.js\` with a default export.
4. Use Tailwind CSS for all styling.
5. All imports must reference files you include or packages in "dependencies".
6. Do NOT include react, react-dom, tailwindcss in "dependencies".
7. Keep code clean, readable, production-quality.
8. NEVER use local image paths. For images use: https://image.pollinations.ai/prompt/{keyword}?width=800&height=600&nologo=true or https://placehold.co/600x400/png
9. **DUAL-MODE DATABASE**: You must create a data abstraction layer (e.g. \`/lib/db.js\`). This layer MUST check if \`process.env.REACT_APP_MONGODB_DATA_API_KEY\` exists. If it does, use the MongoDB Atlas Data API (via \`fetch\`) to persist data to the user's real database. If it does NOT exist, fall back to simulating data with \`localStorage\`. Do NOT attempt to use \`mongoose\` or direct TCP MongoDB connections, as this is a purely browser-based React app.
10. **DEPLOYMENT**: ALWAYS include a \`/README.md\` detailing exactly how to run the app, AND a dedicated section on how to deploy this app to Vercel, including instructions on where to configure the \`REACT_APP_MONGODB_DATA_API_URL\`, \`REACT_APP_MONGODB_DATA_API_KEY\`, and \`REACT_APP_MONGODB_DATA_API_CLUSTER\` environment variables in the Vercel dashboard.
11. If the user is just chatting or asking a question, you can omit the "files" and "dependencies" fields entirely and just respond with "assistantMessage" and "suggestions".
12. When modifying existing code, output ONLY the files that changed. Unchanged files will be preserved automatically.
13. "suggestions" must be an array of exactly 3 specific, actionable short phrases the user could ask for next.`;

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
            const preview = code.length > 3000 ? code.slice(0, 3000) + "\n  ... (truncated)" : code;
            return `// ${path}\n${preview}`;
          })
          .join("\n\n---\n\n");

        text += `\n\nCurrent project files:\n${fileSummary}\nDependencies: ${JSON.stringify(fileData.dependencies ?? {})}`;
      }

      parts.push({ text });
      return { role, parts };
    }

    return { role, parts: [{ text: msg.content }] };
  });
}

// ─── Backend builder removed for pure React ───────────────────────────────────

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
          dependencies?: Record<string, string>;
        }>(rawJson);

        if (!parsed) {
          enqueue(sseEvent("error", { message: "Generation failed. Please try again." }));
          controller.close();
          return;
        }

        const { assistantMessage, title: aiTitle, suggestions, files, dependencies } = parsed;

        // ── Merge existing files with new files ────────────────────────────────

        const normalizedFiles: Record<string, { code: string }> = { ...(fileData?.files ?? {}) };
        
        if (files) {
          for (const [key, value] of Object.entries(files)) {
            let path = key;
            if (!path.startsWith("/")) path = "/" + path;
            if (path.startsWith("/src/") && path.endsWith("App.js")) path = "/App.js";
            
            // Clean markdown fences (e.g. ```jsx ... ```)
            let rawCode = value.code;
            if (typeof rawCode === "string") {
              rawCode = rawCode.replace(/^```[a-z]*\n/i, "").replace(/\n```$/i, "");
            }
            normalizedFiles[path] = { ...value, code: rawCode };
          }
        }

        // ── Validate npm packages ──────────────────────────────────────────────

        enqueue(sseEvent("status", { message: "Validating packages…" }));
        const validatedDeps = await validateDependencies({ 
          ...(fileData?.dependencies ?? {}), 
          ...(dependencies ?? {}) 
        });

        const newFileData: FileData = {
          files: normalizedFiles,
          dependencies: validatedDeps,
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
          workspace = await Workspace.create({
            userId: userObjectId,
            title: aiTitle ?? lastUserMessage.content.slice(0, 80),
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
