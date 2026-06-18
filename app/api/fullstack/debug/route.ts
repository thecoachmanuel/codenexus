import { getSession } from "@/lib/auth";
import { NextRequest } from "next/server";
import { connectDB } from "@/lib/mongodb";
import User from "@/lib/models/User";
import Workspace from "@/lib/models/Workspace";
import { Agent, createTool } from "@cline/sdk";
import { z } from "zod";
import type { FullstackFileData } from "@/types/fullstack";
import mongoose from "mongoose";

const CREDIT_COST_DEBUG_PRO = 2;

function sseEvent(type: string, payload: object): string {
  return `data: ${JSON.stringify({ type, ...payload })}\n\n`;
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session)
    return Response.json({ message: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { userId, workspaceId, fileData, errorLog } = body as {
    userId: string;
    workspaceId?: string;
    fileData: FullstackFileData;
    errorLog: string;
  };

  if (userId !== session.userId)
    return Response.json({ message: "Unauthorized" }, { status: 401 });

  await connectDB();

  const user = await User.findById(userId).select("_id credits plan");
  if (!user)
    return Response.json({ message: "User not found" }, { status: 404 });

  if (user.plan !== "pro")
    return Response.json(
      { message: "Upgrade to Pro to use the Debugger Agent" },
      { status: 403 }
    );

  if (user.credits < CREDIT_COST_DEBUG_PRO)
    return Response.json({ message: "Insufficient credits" }, { status: 402 });

  // ── Stream debug ────────────────────────────────────────────────────────────

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (chunk: string) =>
        controller.enqueue(encoder.encode(chunk));

      const patchedFiles: Record<string, string> = { ...fileData.files };
      let finalSummary = "";

      const updateFileTool = createTool({
        name: "update_file",
        description: "Update or rewrite a file to fix the error. Call once per file you need to change.",
        inputSchema: z.object({
          path: z.string().describe("File path exactly as it appears"),
          code: z.string().describe("Complete new contents of the file"),
          reason: z.string().describe("Explanation of the fix"),
        }),
        async execute({ path, code, reason }) {
          patchedFiles[path] = code;
          enqueue(sseEvent("file_patch", { path, code, reason }));
          return `Updated ${path}: ${reason}`;
        },
      });

      const readFileTool = createTool({
        name: "read_file",
        description: "Read the content of an existing file.",
        inputSchema: z.object({
          path: z.string(),
        }),
        async execute({ path }) {
          const content = patchedFiles[path];
          if (content === undefined) return `Error: file ${path} not found.`;
          return content;
        },
      });

      const doneDebuggingTool = createTool({
        name: "done_debugging",
        description: "Call this when you have applied all fixes for the error.",
        inputSchema: z.object({
          summary: z.string().describe("Summary of what was fixed"),
        }),
        async execute({ summary }) {
          finalSummary = summary;
          return "Finished debugging.";
        },
        lifecycle: { completesRun: true },
      });

      const userRequest = `A build/runtime error occurred in the Next.js app.
Here is the error log:
<error_log>
${errorLog}
</error_log>

Please analyze the error, read the necessary files using the read_file tool, apply fixes using the update_file tool, and call done_debugging when finished.`;

      const agent = new Agent({
        providerId: "gemini",
        systemPrompt: "You are an expert Next.js 14 fullstack developer. Your job is to debug an error that occurred in a generated app and apply fixes.",
        maxIterations: 8,
        tools: [updateFileTool, readFileTool, doneDebuggingTool],
        toolPolicies: {
          update_file: { autoApprove: true },
          read_file: { autoApprove: true },
          done_debugging: { autoApprove: true },
        },
        hooks: {
          onEvent: (event) => {
            if (event.type === "assistant-text-delta" && event.text) {
              enqueue(sseEvent("thinking", { text: event.text }));
            }
            if (event.type === "tool-started") {
              const name = event.toolCall?.toolName;
              if (name === "update_file") {
                const inputObj = event.toolCall?.input as { path?: string };
                enqueue(sseEvent("thinking", { text: `\n\nFixing \`${inputObj?.path ?? "file"}\`…` }));
              } else if (name === "read_file") {
                const inputObj = event.toolCall?.input as { path?: string };
                enqueue(sseEvent("thinking", { text: `\n\nReading \`${inputObj?.path ?? "file"}\`…` }));
              } else if (name === "done_debugging") {
                enqueue(sseEvent("thinking", { text: "\n\nFinalizing fixes…" }));
              }
            }
          },
        },
      });

      try {
        enqueue(sseEvent("status", { message: "Debugger analyzing error…" }));
        const result = await agent.run(userRequest);

        if (result.status === "failed") {
          throw new Error(result.error?.message ?? "Agent run failed");
        }

        const newFileData: FullstackFileData = {
          ...fileData,
          files: patchedFiles,
        };

        if (workspaceId) {
          const userObjectId = new mongoose.Types.ObjectId(userId);
          await Workspace.findOneAndUpdate(
            { _id: workspaceId, userId: userObjectId },
            { "fileData.fullstack": newFileData }
          );
        }

        await User.findByIdAndUpdate(userId, {
          $inc: { credits: -CREDIT_COST_DEBUG_PRO },
        });

        const updatedUser = await User.findById(userId).select("credits");

        enqueue(
          sseEvent("done", {
            fileData: newFileData,
            summary: finalSummary || result.outputText,
            creditsRemaining: updatedUser?.credits ?? user.credits - CREDIT_COST_DEBUG_PRO,
          })
        );
      } catch (err) {
        console.error("[fullstack/debug] error:", err);
        enqueue(
          sseEvent("error", {
            message: err instanceof Error ? err.message : "Debug failed",
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
