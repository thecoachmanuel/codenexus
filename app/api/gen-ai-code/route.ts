import { getSession } from "@/lib/auth";
import { NextRequest } from "next/server";
import { connectDB } from "@/lib/mongodb";
import User from "@/lib/models/User";
import Workspace from "@/lib/models/Workspace";
import { DEFAULT_MODEL, getApiKey } from "@/lib/gemini";
import { calculateGenerationCost } from "@/lib/credit-calculator";
import type { Message, FileData } from "@/types/workspace";
import mongoose from "mongoose";
import { Agent, createTool } from "@cline/sdk";
import { z } from "zod";

// ─── SSE helper ───────────────────────────────────────────────────────────────

function sseEvent(type: string, payload: unknown): string {
  return `data: ${JSON.stringify({ type, ...(payload as object) })}\n\n`;
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

// ─── System Prompts ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert React developer. Generate a complete, working React frontend application using the provided tools.

CRITICAL RULES:
1. Use React functional components + hooks. NO TypeScript in generated files.
2. Use standard clean React architecture: put components in \`/components\`, pages in \`/pages\`, hooks in \`/hooks\`, and utils in \`/lib\`.
3. Entry point MUST be \`/App.js\` with a default export.
4. Use Tailwind CSS for all styling.
5. All imports must reference files you create or packages you add via 'add_dependency'.
6. Do NOT add react, react-dom, or tailwindcss to 'add_dependency'. They are pre-installed.
7. NEVER use local image paths. For placeholder images, ALWAYS use: https://image.pollinations.ai/prompt/{keyword}?width=800&height=600&nologo=true
8. **DUAL-MODE DATABASE**: You must create a data abstraction layer (e.g. \`/lib/db.js\`). This layer MUST check if \`process.env.REACT_APP_MONGODB_DATA_API_KEY\` exists. If it does, use the MongoDB Atlas Data API (via \`fetch\`) to persist data. If it does NOT exist, fall back to simulating data with \`localStorage\`. Do NOT attempt to use \`mongoose\` or direct TCP MongoDB connections.
9. **DEPLOYMENT**: ALWAYS include a \`/README.md\` detailing exactly how to run the app AND deploy it to Vercel, including configuring the \`REACT_APP_MONGODB_DATA_API_KEY\` environment variables in the Vercel dashboard.
10. **MOBILE-FIRST & RESPONSIVE**: You MUST design the application to be highly responsive and mobile-first. All layouts, sidebars, navigation menus, and content grids MUST collapse and adapt gracefully to small screens (e.g., using Tailwind's sm:, md:, lg: prefixes). Mobile responsiveness is CRITICAL.

WORKFLOW:
1. Review the user's request.
2. Use 'list_files' and 'read_file' to understand existing code if modifying an app.
3. Use 'update_file' to create or modify code.
4. Use 'add_dependency' to install required npm packages.
5. Use 'finish_generation' exactly once when you are completely done. Provide a user-facing assistant message, a short title for the app, and 3 actionable suggestions for the user.`;

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
        enqueue(sseEvent("status", { message: "Starting Cline Agent…" }));

        const patchedFiles: Record<string, { code: string }> = {
          ...(fileData?.files ?? {}),
        };
        
        const newDependencies: Record<string, string> = {
          ...(fileData?.dependencies ?? {}),
        };
        
        const lastUserMessage = messages[messages.length - 1];
        let finalTitle = fileData?.title ?? lastUserMessage.content.slice(0, 80);
        let finalAssistantMessage = "I have updated the application.";
        let finalSuggestions: string[] = fileData?.suggestions ?? [];

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
          description: "Create or rewrite a FRONTEND file in the React sandbox. Call once per file you need to change.",
          inputSchema: z.object({
            path: z.string().describe("File path exactly as it appears, e.g. /App.js"),
            code: z.string().describe("Complete new contents of the file"),
            reason: z.string().describe("One sentence explaining what you changed and why"),
          }),
          async execute({ path, code, reason }) {
            let normalizedPath = path;
            if (!normalizedPath.startsWith("/")) normalizedPath = "/" + normalizedPath;
            if (normalizedPath.startsWith("/src/") && normalizedPath.endsWith("App.js")) {
              normalizedPath = "/App.js";
            }
            patchedFiles[normalizedPath] = { code };
            enqueue(sseEvent("status", { message: `Updating ${normalizedPath}…` }));
            return `Updated frontend ${normalizedPath}: ${reason}`;
          },
        });

        const addDependencyTool = createTool({
          name: "add_dependency",
          description: "Add an npm dependency required by your code.",
          inputSchema: z.object({
            packageName: z.string().describe("The name of the npm package"),
            version: z.string().describe("The version (e.g. 'latest')"),
          }),
          async execute({ packageName, version }) {
            newDependencies[packageName] = version;
            enqueue(sseEvent("status", { message: `Adding dependency ${packageName}…` }));
            return `Added dependency ${packageName}@${version}`;
          },
        });

        const finishGenerationTool = createTool({
          name: "finish_generation",
          description: "Call this exactly once when you have finished all file updates.",
          inputSchema: z.object({
            title: z.string().describe("A short 2-4 word title for the app (e.g. 'Task Manager')"),
            assistantMessage: z.string().describe("A friendly summary of what you built or changed, directed at the user."),
            suggestions: z.array(z.string()).length(3).describe("Exactly 3 specific, actionable short phrases the user could ask for next.")
          }),
          lifecycle: { completesRun: true },
          async execute({ title, assistantMessage, suggestions }) {
            finalTitle = title;
            finalAssistantMessage = assistantMessage;
            finalSuggestions = suggestions;
            enqueue(sseEvent("status", { message: "Finalizing generation…" }));
            return "Done.";
          },
        });

        const agent = new Agent({
          providerId: "gemini",
          modelId: DEFAULT_MODEL,
          apiKey: getApiKey(),
          maxIterations: 15,
          systemPrompt: SYSTEM_PROMPT,
          tools: [listFilesTool, readFileTool, updateFileTool, addDependencyTool, finishGenerationTool],
          toolPolicies: {
            list_files: { autoApprove: true },
            read_file: { autoApprove: true },
            update_file: { autoApprove: true },
            add_dependency: { autoApprove: true },
            finish_generation: { autoApprove: true },
          },
          hooks: {
            onEvent: (event) => {
              if (event.type === "assistant-text-delta" && event.text) {
                enqueue(sseEvent("status", { message: "Thinking..." }));
              }
            },
          },
        });

        const trimmed = trimHistory(messages);
        let userRequest = trimmed
          .map((m) => {
            let text = m.content;
            if (m.imageUrl) {
              if (m.imageUrl.startsWith("data:image/")) {
                text = `[Image attached as design reference.]\n\n${text}`;
              } else {
                text = `[Image URL for reference: ${m.imageUrl}]\n\n${text}`;
              }
            }
            return `${m.role.toUpperCase()}:\n${text}`;
          })
          .join("\n\n---\n\n");

        if (Object.keys(patchedFiles).length > 0) {
          const fileSummary = Object.entries(patchedFiles)
            .map(([path, { code }]) => `### ${path}\n\`\`\`\n${code}\n\`\`\``)
            .join("\n\n");
          userRequest += `\n\n--- CURRENT PROJECT FILES ---\n${fileSummary}`;
        }

        const result = await agent.run(userRequest);

        if (result.status === "failed") {
          throw new Error(result.error?.message ?? "Agent run failed");
        }

        // ── Validate npm packages ──────────────────────────────────────────────

        enqueue(sseEvent("status", { message: "Validating packages…" }));
        const validatedDeps = await validateDependencies(newDependencies);

        const newFileData: FileData = {
          files: patchedFiles,
          dependencies: validatedDeps,
          title: finalTitle,
          suggestions: finalSuggestions,
          envVars: fileData?.envVars,
        };

        // ── Upsert workspace + deduct credit ──────────────────────────────────

        enqueue(sseEvent("status", { message: "Saving…" }));

        const updatedMessages: Message[] = [
          ...messages,
          { role: "assistant", content: finalAssistantMessage },
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
          const subdomain = "app-" + Math.random().toString(36).substring(2, 9);
          
          workspace = await Workspace.create({
            userId: userObjectId,
            title: finalTitle,
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
            assistantMessage: finalAssistantMessage,
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
