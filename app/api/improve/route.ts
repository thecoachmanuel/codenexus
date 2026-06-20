import { getSession } from "@/lib/auth";
import { NextRequest } from "next/server";
import { Agent, createTool } from "@cline/sdk";
import { z } from "zod";
import { connectDB } from "@/lib/mongodb";
import User from "@/lib/models/User";
import Workspace from "@/lib/models/Workspace";
import { calculateImprovementCost } from "@/lib/credit-calculator";
import { getApiKey, rotateApiKey, PRO_MODEL } from "@/lib/gemini";
import type { FileData } from "@/types/workspace";
import mongoose from "mongoose";

// ─── SSE helper ───────────────────────────────────────────────────────────────

function sseEvent(type: string, payload: object): string {
  return `data: ${JSON.stringify({ type, ...payload })}\n\n`;
}

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

  // Verify the userId matches the session
  if (userId !== session.userId) {
    return Response.json({ message: "Unauthorized" }, { status: 401 });
  }

  await connectDB();

  const user = await User.findById(userId).select("_id credits plan");
  if (!user)
    return Response.json({ message: "User not found" }, { status: 404 });

  // Pro-only gate
  if (user.plan !== "pro")
    return Response.json({ message: "Upgrade required" }, { status: 403 });

  const cost = calculateImprovementCost(fileData, userRequest);

  if (user.credits < cost)
    return Response.json({ message: `Insufficient credits. This complex task requires ${cost} credits, but you only have ${user.credits}.` }, { status: 402 });

  // ── Build the agent ────────────────────────────────────────────────────────

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (chunk: string) =>
        controller.enqueue(encoder.encode(chunk));

      const patchedFiles: Record<string, { code: string }> = {
        ...(fileData.files ?? {}),
      };
      let finalSummary = "";

      const listFilesTool = createTool({
        name: "list_files",
        description: "List all files currently in the React sandbox.",
        inputSchema: z.object({}),
        async execute() {
          return JSON.stringify(Object.keys(patchedFiles), null, 2);
        },
      });

      const readFileTool = createTool({
        name: "read_file",
        description: "Read the contents of a specific file.",
        inputSchema: z.object({
          path: z.string().describe("File path, e.g. /App.js"),
        }),
        async execute({ path }) {
          let normalizedPath = path;
          if (!normalizedPath.startsWith("/")) normalizedPath = "/" + normalizedPath;
          const file = patchedFiles[normalizedPath];
          if (!file) return `Error: File ${normalizedPath} not found.`;
          return file.code;
        },
      });

      const updateFileTool = createTool({
        name: "update_file",
        description:
          "Update or rewrite a FRONTEND file in the React sandbox. Call once per file you need to change.",
        inputSchema: z.object({
          path: z
            .string()
            .describe("File path exactly as it appears, e.g. /App.js"),
          code: z.string().describe("Complete new contents of the file"),
          reason: z
            .string()
            .describe("One sentence explaining what you changed and why"),
        }),
        async execute({ path, code, reason }) {
          let normalizedPath = path;
          if (!normalizedPath.startsWith("/")) normalizedPath = "/" + normalizedPath;
          if (normalizedPath.startsWith("/src/") && normalizedPath.endsWith("App.js")) {
            normalizedPath = "/App.js";
          }
          patchedFiles[normalizedPath] = { code };
          enqueue(sseEvent("file_patch", { path: normalizedPath, code, reason }));
          return `Updated frontend ${normalizedPath}: ${reason}`;
        },
      });


      const doneImprovingTool = createTool({
        name: "done_improving",
        description:
          "Call this when you have finished making all improvements.",
        inputSchema: z.object({
          summary: z
            .string()
            .describe(
              "A short friendly summary of all the improvements you made (1-3 sentences)"
            ),
        }),
        lifecycle: { completesRun: true },
        async execute({ summary }) {
          finalSummary = summary;
          return "Done.";
        },
      });

      try {
        let result: any;
        const maxAttempts = 3;
        
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          const agent = new Agent({
            providerId: "gemini",
            modelId: PRO_MODEL,
            apiKey: getApiKey(),
            maxIterations: 15,
            systemPrompt: `You are an expert full-stack React developer improving an app.

WORKFLOW:
1. Understand what the user wants improved.
2. Use \`list_files\` to see the directory structure.
3. Use \`read_file\` to read ONLY the specific files you need to understand or modify. Do not guess file contents.
4. Call \`update_file\` to rewrite the files with your improvements.
5. Once all files are updated, call \`done_improving\` with a short summary.

CRITICAL RULES:
1. Use standard clean React architecture: \`/components\`, \`/pages\`, \`/hooks\`, \`/lib\`.
2. Entry point MUST be \`/App.js\` with a default export. NO TypeScript in generated code.
3. Use Tailwind CSS for all styling.
4. **UNLIMITED DEPENDENCIES**: You are free to use ANY npm package you need. If you add or change imports, also call \`update_file\` on \`/package.json\` (in the files object passed to done_improving) to add the new package. Use the best library for the job.
5. **BROWSER-ONLY RULE**: Never use Node.js-only packages (mongoose, express, fs, net, nodemailer, etc.). If you encounter such a package in existing code, replace it with a browser-safe alternative.
6. **AUTO-FIX DEPENDENCIES**: If the user reports a dependency/import error, identify the problematic package and either replace it with a well-known browser-compatible alternative or rewrite that section of code to not require the package.
7. **DUAL-MODE DATABASE**: Use the data abstraction layer (e.g. \`/lib/db.js\`). Check if \`process.env.REACT_APP_MONGODB_DATA_API_KEY\` exists — if so, use MongoDB Atlas Data API via fetch; otherwise fall back to \`localStorage\`.
8. **DEPLOYMENT**: Keep the \`/README.md\` up to date.
9. Always write complete file contents — never partial snippets.
10. NEVER use local image paths. For placeholder images, ALWAYS use: https://image.pollinations.ai/prompt/{keyword}?width=800&height=600&nologo=true or https://placehold.co/600x400/png
11. **MOBILE-FIRST & RESPONSIVE**: Highly responsive and mobile-first at all times.
12. **LIGHT MODE DEFAULT**: Light mode by default unless user requests dark.`,
            tools: [listFilesTool, readFileTool, updateFileTool, doneImprovingTool],
            toolPolicies: {
              list_files: { autoApprove: true },
              read_file: { autoApprove: true },
              update_file: { autoApprove: true },
              done_improving: { autoApprove: true },
            },
            hooks: {
              onEvent: (event) => {
                if (event.type === "assistant-text-delta" && event.text) {
                  enqueue(sseEvent("thinking", { text: event.text }));
                }
                if (event.type === "tool-started") {
                  const name = event.toolCall?.toolName;
                  if (name === "update_file") {
                    const path =
                      (event.toolCall?.input as { path?: string })?.path ?? "a file";
                    enqueue(
                      sseEvent("thinking", { text: `\n\nUpdating \`${path}\`…` })
                    );
                  } else if (name === "done_improving") {
                    enqueue(
                      sseEvent("thinking", { text: "\n\nFinalizing improvements…" })
                    );
                  }
                }
              },
            },
          });

          try {
            if (attempt === 0) enqueue(sseEvent("status", { message: "Agent starting…" }));
            
            result = await agent.run(userRequest);
            
            if (result.status === "failed") {
              const msg = (result.error?.message ?? "").toLowerCase();
              if ((msg.includes("429") || msg.includes("503") || msg.includes("rate limit") || msg.includes("quota") || msg.includes("overloaded")) && attempt < maxAttempts - 1) {
                console.warn("[improve] Agent rate limited, rotating key...");
                rotateApiKey();
                continue;
              }
              throw new Error(result.error?.message ?? "Agent run failed");
            }
            
            // Successfully finished run
            break;
          } catch (err: any) {
            const msg = (err.message || String(err)).toLowerCase();
            if ((msg.includes("429") || msg.includes("503") || msg.includes("rate limit") || msg.includes("quota") || msg.includes("overloaded")) && attempt < maxAttempts - 1) {
              console.warn("[improve] Agent exception (rate limit), rotating key...");
              rotateApiKey();
              continue;
            }
            throw err;
          }
        }

        const newFileData: FileData = {
          files: patchedFiles,
          dependencies: fileData.dependencies,
          title: fileData.title,
          envVars: fileData.envVars,
          suggestions: fileData.suggestions,
        };

        const userObjectId = new mongoose.Types.ObjectId(userId);

        await Workspace.findOneAndUpdate(
          { _id: workspaceId, userId: userObjectId },
          { fileData: newFileData }
        );

        await User.findByIdAndUpdate(userId, {
          $inc: { credits: -cost },
        });

        const updatedUser = await User.findById(userId).select("credits");

        enqueue(
          sseEvent("done", {
            fileData: newFileData,
            summary: finalSummary || result.outputText,
            creditsRemaining:
              updatedUser?.credits ?? user.credits - cost,
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
