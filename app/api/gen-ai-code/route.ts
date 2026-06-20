import { getSession } from "@/lib/auth";
import { NextRequest } from "next/server";
import { connectDB } from "@/lib/mongodb";
import User from "@/lib/models/User";
import Workspace from "@/lib/models/Workspace";
import { PRO_MODEL, getApiKey, rotateApiKey, getApiKeysCount } from "@/lib/gemini";
import { calculateGenerationCost } from "@/lib/credit-calculator";
import type { Message, FileData } from "@/types/workspace";
import mongoose from "mongoose";
import { Agent, createTool } from "@cline/sdk";
import { z } from "zod";
import { extractDependencies, findMissingFiles } from "@/lib/dependencies";
import { BASE_DEPENDENCIES } from "@/lib/constants";

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
        enqueue(sseEvent("status", { message: "Starting agent…" }));

        const patchedFiles: Record<string, { code: string }> = {
          ...(fileData?.files ?? {}),
        };
        
        let finalAssistantMessage = "";
        let finalTitle = fileData?.title ?? "Untitled App";
        let finalSuggestions: string[] = fileData?.suggestions ?? [];
        let finalDependencies: Record<string, string> = {};

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
            "Create or Update a FRONTEND file in the React sandbox. Call once per file you need to create or change.",
          inputSchema: z.object({
            path: z
              .string()
              .describe("File path exactly as it appears, e.g. /App.js or /components/Header.js"),
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
            
            // Clean markdown fences (e.g. ```jsx ... ```)
            let rawCode = code;
            if (typeof rawCode === "string") {
              rawCode = rawCode.replace(/^\s*```[a-z]*\n/i, "").replace(/\n```\s*$/i, "");
            }
            
            patchedFiles[normalizedPath] = { code: rawCode };
            enqueue(sseEvent("file_patch", { path: normalizedPath, code: rawCode, reason }));
            return `Updated frontend ${normalizedPath}: ${reason}`;
          },
        });

        const doneGeneratingTool = createTool({
          name: "done_generating",
          description:
            "Call this when you have finished making all generations or improvements. You MUST call this tool to complete the task.",
          inputSchema: z.object({
            assistantMessage: z
              .string()
              .describe("A friendly summary of what you built or improved (1-3 sentences)"),
            title: z
              .string()
              .describe("A short 2-4 word title for this app"),
            suggestions: z
              .array(z.string())
              .describe("Array of exactly 3 specific, actionable short phrases the user could ask for next"),
            dependencies: z
              .record(z.string(), z.string())
              .optional()
              .describe("Any NEW npm dependencies needed (e.g. { \"lodash\": \"latest\" }). Do NOT include react, react-dom, or tailwindcss."),
          }),
          lifecycle: { completesRun: true },
          async execute({ assistantMessage, title, suggestions, dependencies }) {
            // Prevent Agent from skipping generation on brand new projects
            if (!fileData && !patchedFiles["/App.js"]) {
              throw new Error("Generation rejected! You forgot to use the `update_file` tool to create the app files. You MUST create at least `/App.js` before calling done_generating.");
            }

            const missing = findMissingFiles(patchedFiles);
            if (missing.length > 0) {
              throw new Error(`Generation rejected! You imported the following files but forgot to create them:\n${missing.join('\n')}\n\nYou MUST use update_file to create these missing files before you are allowed to call done_generating.`);
            }

            finalAssistantMessage = assistantMessage;
            if (title) finalTitle = title;
            if (suggestions && suggestions.length > 0) finalSuggestions = suggestions;
            if (dependencies) finalDependencies = dependencies;
            return "Done.";
          },
        });

        // Format conversation history for the agent prompt
        let conversationText = "";
        messages.forEach((msg) => {
          conversationText += `\n\n---\n**${msg.role === "assistant" ? "Agent" : "User"}**:\n${msg.content}`;
          if (msg.imageUrl) conversationText += `\n[Attached image]`;
        });
        
        let initialFileContext = "";
        if (fileData) {
            initialFileContext = `\n\nCurrent project files:\n${Object.keys(fileData.files ?? {}).join(", ")}\nDependencies: ${JSON.stringify(fileData.dependencies ?? {})}`;
        } else {
            initialFileContext = `\n\nThis is a brand new project. Create the foundational files, ensuring you create an /App.js entry point.`;
        }

        const userRequest = `You must fulfill the latest user request. You are an expert full-stack React developer.\n\nConversation History:${conversationText}${initialFileContext}`;

        const keysCount = getApiKeysCount();
        const maxAttempts = keysCount * 2;
        let result: any;
        
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          // If we've exhausted all keys on the primary model, fall back to flash-lite
          let currentModelId = attempt < keysCount ? PRO_MODEL : "gemini-2.5-flash-lite";
          
          const agent = new Agent({
            providerId: "gemini",
            modelId: currentModelId,
            apiKey: getApiKey(),
            maxIterations: 20,
            systemPrompt: `You are an expert full-stack React developer generating an app.

WORKFLOW:
1. Understand the user's request.
2. If the user is asking a general question, just call \`done_generating\` with the answer in \`assistantMessage\`.
3. If building or modifying an app:
   - Use \`list_files\` and \`read_file\` to understand the current state.
   - Use \`update_file\` to create or modify ALL necessary files. You MUST create/update all files required.
4. Once all files are updated, call \`done_generating\`.

CRITICAL RULES:
1. **ARCHITECTURE**: Use standard clean React architecture: \`/components\`, \`/pages\`, \`/hooks\`, \`/lib\`. Entry point MUST be \`/App.js\` with a default export. NO TypeScript.
2. **RICH AESTHETICS & UI/UX**: You MUST build premium, state-of-the-art designs. Use modern web design best practices (vibrant colors, glassmorphism, soft shadows, rounded corners). The user should be WOWED at first glance.
3. **DYNAMIC ANIMATIONS**: Use \`framer-motion\` to add micro-interactions, page transitions, and hover effects. An interface that feels alive encourages interaction.
4. **COMPLETENESS**: DO NOT stub out files or use placeholders like \`// implement later\`. Write fully-featured, production-ready code. Always write complete file contents.
5. **STYLING**: Use Tailwind CSS for all styling. Rely on utility classes exclusively.
6. **DATABASE**: If modifying data fetching, use a data abstraction layer (e.g. \`/lib/db.js\`). Check if \`process.env.REACT_APP_MONGODB_DATA_API_KEY\` exists to use Atlas, else simulate with \`localStorage\`.
7. **DEPLOYMENT**: Keep \`/README.md\` updated with instructions for running and deploying to Vercel.
8. **IMAGES**: NEVER use local image paths. ALWAYS use: https://image.pollinations.ai/prompt/{keyword}?width=800&height=600&nologo=true or https://placehold.co/600x400/png
9. **MOBILE-FIRST**: You MUST design the application to be highly responsive and adapt gracefully to mobile screens.
10. **LIGHT MODE DEFAULT**: Design in light mode by default unless requested otherwise.
11. **NO ORPHANED CSS**: Our boilerplate imports \`./styles.css\` globally. DO NOT import \`./index.css\` or \`./App.css\`.`,
            tools: [listFilesTool, readFileTool, updateFileTool, doneGeneratingTool],
            toolPolicies: {
              list_files: { autoApprove: true },
              read_file: { autoApprove: true },
              update_file: { autoApprove: true },
              done_generating: { autoApprove: true },
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
                  } else if (name === "done_generating") {
                    enqueue(
                      sseEvent("thinking", { text: "\n\nFinalizing app generation…" })
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
              if (attempt < maxAttempts - 1) {
                console.warn("[gen-ai-code] Agent failed, falling back to next model/key...");
                rotateApiKey();
                continue;
              }
              throw new Error(result.error?.message ?? "Agent run failed");
            }
            
            break;
          } catch (err: any) {
            if (attempt < maxAttempts - 1) {
              console.warn("[gen-ai-code] Agent exception, falling back to next model/key...");
              rotateApiKey();
              continue;
            }
            throw err;
          }
        }

        if (!finalAssistantMessage) {
            finalAssistantMessage = result?.outputText || "I have completed the task.";
        }

        // ── Validate npm packages ──────────────────────────────────────────────

        enqueue(sseEvent("status", { message: "Validating packages…" }));
        
        // Auto-extract dependencies from code to prevent Agent forgetfulness
        const extracted = extractDependencies(patchedFiles);
        extracted.forEach(pkg => {
          if (!finalDependencies[pkg]) finalDependencies[pkg] = "latest";
        });

        const mergedDeps = { 
          ...(fileData?.dependencies ?? {}), 
          ...(finalDependencies ?? {}),
          ...BASE_DEPENDENCIES // Force base versions (framer-motion ^10, recharts, etc) to win
        };
        
        // Remove problematic packages that crash Sandpack
        delete mergedDeps["tailwindcss"];
        delete mergedDeps["postcss"];
        delete mergedDeps["autoprefixer"];
        delete mergedDeps["react"];
        delete mergedDeps["react-dom"];

        const validatedDeps = await validateDependencies(mergedDeps);

        const newFileData: FileData = {
          files: patchedFiles,
          dependencies: validatedDeps,
          title: finalTitle,
          suggestions: finalSuggestions,
          envVars: fileData?.envVars,
        };

        // ── Upsert workspace + deduct credit ──────────────────────────────────

        enqueue(sseEvent("status", { message: "Saving…" }));

        const lastUserMessage = messages[messages.length - 1];
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
          // Generate a unique, readable subdomain (e.g. app-xxxxx)
          const subdomain = "app-" + Math.random().toString(36).substring(2, 9);
          
          workspace = await Workspace.create({
            userId: userObjectId,
            title: finalTitle ?? lastUserMessage.content.slice(0, 80),
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
      } catch (err: any) {
        console.error("[gen-ai-code] stream error:", err);
        enqueue(
          sseEvent("error", {
            message: err?.message ?? "Something went wrong. Please try again.",
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
