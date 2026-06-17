import { getSession } from "@/lib/auth";
import { NextRequest } from "next/server";
import { GoogleGenAI, Type } from "@google/genai";
import { connectDB } from "@/lib/mongodb";
import User from "@/lib/models/User";
import Workspace from "@/lib/models/Workspace";
import { CREDIT_COST_PER_GENERATION } from "@/lib/constants";
import { getApiKey, DEFAULT_MODEL } from "@/lib/gemini";
import type { FileData } from "@/types/workspace";
import mongoose from "mongoose";

// ─── SSE helper ───────────────────────────────────────────────────────────────

function sseEvent(type: string, payload: object): string {
  return `data: ${JSON.stringify({ type, ...payload })}\n\n`;
}

// ─── Tool declarations ────────────────────────────────────────────────────────

const tools = [
  {
    functionDeclarations: [
      {
        name: "update_file",
        description:
          "Update or rewrite a file in the React sandbox. Call once per file you need to change. Always write the COMPLETE file contents.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            path: {
              type: Type.STRING,
              description: "File path exactly as it appears, e.g. /App.js",
            },
            code: {
              type: Type.STRING,
              description: "Complete new contents of the file",
            },
            reason: {
              type: Type.STRING,
              description: "One sentence explaining what you changed and why",
            },
          },
          required: ["path", "code", "reason"],
        },
      },
      {
        name: "done_improving",
        description:
          "Call this once when you have finished making ALL improvements. Do not call any more tools after this.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            summary: {
              type: Type.STRING,
              description:
                "A short friendly summary of all the improvements you made (1–3 sentences)",
            },
          },
          required: ["summary"],
        },
      },
    ],
  },
];

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session)
    return Response.json({ message: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { userId, workspaceId, userRequest, fileData } = body as {
    userId: string;
    workspaceId: string;
    userRequest: string;
    fileData: FileData;
  };

  if (userId !== session.userId)
    return Response.json({ message: "Unauthorized" }, { status: 401 });

  await connectDB();

  const user = await User.findById(userId).select("_id credits plan");
  if (!user)
    return Response.json({ message: "User not found" }, { status: 404 });

  if (user.plan !== "pro")
    return Response.json({ message: "Upgrade required" }, { status: 403 });

  if (user.credits < CREDIT_COST_PER_GENERATION)
    return Response.json({ message: "Insufficient credits" }, { status: 402 });

  // ── Build the stream ────────────────────────────────────────────────────────

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (chunk: string) =>
        controller.enqueue(encoder.encode(chunk));

      const patchedFiles: Record<string, { code: string }> = {
        ...fileData.files,
      };
      let finalSummary = "";

      const fileContext = Object.entries(fileData.files)
        .map(([path, { code }]) => `// ${path}\n${code}`)
        .join("\n\n---\n\n");

      const systemPrompt = `You are an expert React developer improving a live browser preview app.

The app uses React (functional components), Tailwind CSS for styling, and runs in Sandpack.
You CANNOT use TypeScript, CSS modules, or real npm install — only what's already available.
Available packages: react, react-dom, tailwindcss (CDN), lucide-react, recharts, react-router-dom, framer-motion, date-fns, zod, react-hook-form.

Here are the current files:

${fileContext}

WORKFLOW:
1. Understand what the user wants improved.
2. Identify which files need to change.
3. Call update_file for each file that needs changes (always include the COMPLETE file, not just the diff).
4. Once all files are updated, call done_improving with a short summary.

RULES:
- Always write complete file contents — never partial snippets.
- Keep all existing functionality unless asked to remove it.
- The entry point is always /App.js with a default export.
- All imports must reference files you've updated or packages in the available list above.
- NEVER use local image paths (like /assets/img.png).
- NEVER use source.unsplash.com.
- For placeholder images, ALWAYS use:
  - https://image.pollinations.ai/prompt/{keyword}?width=800&height=600&nologo=true (for contextual photos)
  - https://placehold.co/600x400/png (for generic)
  - https://ui-avatars.com/api/?name=John+Doe&background=random (for avatars)`;

      try {
        enqueue(sseEvent("status", { message: "Agent starting…" }));

        const ai = new GoogleGenAI({ apiKey: getApiKey() });

        // Multi-turn agentic loop
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const history: any[] = [
          {
            role: "user",
            parts: [{ text: userRequest }],
          },
        ];

        const MAX_ITERATIONS = 10;
        let isDone = false;

        for (let iteration = 0; iteration < MAX_ITERATIONS && !isDone; iteration++) {
          const response = await ai.models.generateContent({
            model: DEFAULT_MODEL,
            contents: history,
            config: {
              systemInstruction: systemPrompt,
              tools,
            },
          });

          const candidate = response.candidates?.[0];
          if (!candidate?.content?.parts) break;

          // Push model response to history
          history.push({ role: "model", parts: candidate.content.parts });

          // Process parts: stream thinking text and handle function calls
          const functionResponses = [];
          let hasToolCall = false;

          for (const part of candidate.content.parts) {
            if (part.text) {
              enqueue(sseEvent("thinking", { text: part.text }));
            }

            if (part.functionCall) {
              hasToolCall = true;
              const { name, args } = part.functionCall;

              if (name === "update_file" && args) {
                let path = (args.path as string) ?? "/App.js";
                const code = (args.code as string) ?? "";
                const reason = (args.reason as string) ?? "";

                if (!path.startsWith("/")) path = "/" + path;
                // Normalize src/App.js -> /App.js
                if (path.startsWith("/src/") && path.endsWith("App.js")) {
                  path = "/App.js";
                }

                patchedFiles[path] = { code };
                enqueue(sseEvent("file_patch", { path, code, reason }));
                enqueue(sseEvent("thinking", { text: `\n\nUpdating \`${path}\`… ${reason}` }));

                functionResponses.push({
                  functionResponse: {
                    name: "update_file",
                    response: { output: `Updated ${path}: ${reason}` },
                  },
                });
              }

              if (name === "done_improving" && args) {
                finalSummary = (args.summary as string) ?? "";
                enqueue(sseEvent("thinking", { text: "\n\nFinalizing improvements…" }));
                isDone = true;

                functionResponses.push({
                  functionResponse: {
                    name: "done_improving",
                    response: { output: "Done." },
                  },
                });
              }
            }
          }

          // If there were tool calls, add their responses to history and continue the loop
          if (hasToolCall && functionResponses.length > 0) {
            history.push({ role: "user", parts: functionResponses });
          }

          // If no tool call was made and not marked done, stop (model gave a plain text reply)
          if (!hasToolCall) break;
        }

        const newFileData: FileData = {
          files: patchedFiles,
          dependencies: fileData.dependencies,
          title: fileData.title,
        };

        const userObjectId = new mongoose.Types.ObjectId(userId);

        await Workspace.findOneAndUpdate(
          { _id: workspaceId, userId: userObjectId },
          { fileData: newFileData }
        );

        await User.findByIdAndUpdate(userId, {
          $inc: { credits: -CREDIT_COST_PER_GENERATION },
        });

        const updatedUser = await User.findById(userId).select("credits");

        enqueue(
          sseEvent("done", {
            fileData: newFileData,
            summary: finalSummary || "Improvements applied.",
            creditsRemaining:
              updatedUser?.credits ?? user.credits - CREDIT_COST_PER_GENERATION,
          })
        );
      } catch (err) {
        console.error("[improve] error:", err);
        enqueue(
          sseEvent("error", {
            message:
              err instanceof Error ? err.message : "Something went wrong.",
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
