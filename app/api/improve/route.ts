import { getSession } from "@/lib/auth";
import { NextRequest } from "next/server";
import { Agent, createTool } from "@cline/sdk";
import { z } from "zod";
import { connectDB } from "@/lib/mongodb";
import User from "@/lib/models/User";
import Workspace from "@/lib/models/Workspace";
import { CREDIT_COST_PER_GENERATION } from "@/lib/constants";
import { getApiKey, PRO_MODEL } from "@/lib/gemini";
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

  if (user.credits < CREDIT_COST_PER_GENERATION)
    return Response.json({ message: "Insufficient credits" }, { status: 402 });

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

      let fileContext = "FRONTEND FILES (React):\n";
      fileContext += Object.entries(fileData.files ?? {})
        .map(([path, { code }]) => `// ${path}\n${code}`)
        .join("\n\n---\n\n");

      const agent = new Agent({
        providerId: "gemini",
        modelId: PRO_MODEL,
        apiKey: getApiKey(),
        maxIterations: 8,
        systemPrompt: `You are an expert full-stack React developer improving an app.

Here are the current files:

${fileContext}

WORKFLOW:
1. Understand what the user wants improved.
2. Identify which frontend files need to change.
3. Call \`update_file\` for frontend files.
4. Once all files are updated, call \`done_improving\` with a short summary.

CRITICAL RULES:
1. Use standard clean React architecture: \`/src/components\`, \`/src/pages\`, \`/src/hooks\`, \`/src/lib\`.
2. Entry point MUST be \`/App.js\` with a default export. NO TypeScript in generated code.
3. Use Tailwind CSS for all styling.
4. **DUAL-MODE DATABASE**: If modifying data fetching, use the data abstraction layer (e.g. \`/src/lib/db.js\`). This layer MUST check if \`process.env.REACT_APP_MONGODB_DATA_API_KEY\` exists. If it does, use the MongoDB Atlas Data API (via \`fetch\`) to persist data to the real database. If it does NOT exist, fall back to simulating data with \`localStorage\`. Do NOT attempt to use \`mongoose\` or direct TCP MongoDB connections, as this is a browser-based React app.
5. **DEPLOYMENT**: Keep the \`/README.md\` up to date. It should detail exactly how to run the app AND deploy it to Vercel (including where to configure the \`REACT_APP_MONGODB_DATA_API_KEY\` environment variables in the Vercel dashboard).
6. Always write complete file contents — never partial snippets.
7. NEVER use local image paths. For placeholder images, ALWAYS use: https://image.pollinations.ai/prompt/{keyword}?width=800&height=600&nologo=true or https://placehold.co/600x400/png`,
        tools: [updateFileTool, doneImprovingTool],
        toolPolicies: {
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
        enqueue(sseEvent("status", { message: "Agent starting…" }));
        const result = await agent.run(userRequest);

        if (result.status === "failed") {
          throw new Error(result.error?.message ?? "Agent run failed");
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
          $inc: { credits: -CREDIT_COST_PER_GENERATION },
        });

        const updatedUser = await User.findById(userId).select("credits");

        enqueue(
          sseEvent("done", {
            fileData: newFileData,
            summary: finalSummary || result.outputText,
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
