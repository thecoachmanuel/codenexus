import { getSession } from "@/lib/auth";
import { NextRequest } from "next/server";
import { Agent, createTool } from "@cline/sdk";
import { z } from "zod";
import { extractDependencies, findMissingFiles } from "@/lib/dependencies";
import { BASE_DEPENDENCIES } from "@/lib/constants";
import { connectDB } from "@/lib/mongodb";
import User from "@/lib/models/User";
import Workspace from "@/lib/models/Workspace";
import { calculateImprovementCost } from "@/lib/credit-calculator";
import { PRO_MODEL, getApiKey, rotateApiKey, getApiKeysCount } from "@/lib/gemini";
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
      let finalSuggestions = fileData.suggestions ?? [];

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
          if (normalizedPath.startsWith("/src/")) {
            normalizedPath = normalizedPath.replace("/src/", "/");
          }
          if (normalizedPath === "/App.jsx" || normalizedPath === "/App.tsx") {
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
          newSuggestions: z.array(z.string()).optional(),
        }),
        async execute({ summary, newSuggestions }) {
          const missing = findMissingFiles(patchedFiles);
          if (missing.length > 0) {
            throw new Error(`Improvement rejected! You imported the following files but forgot to create them:\n${missing.join('\n')}\n\nYou MUST use update_file to create these missing files before you are allowed to call done_improving.`);
          }

          finalSummary = summary;
          if (newSuggestions && newSuggestions.length > 0) {
            finalSuggestions = newSuggestions;
          }
          return "Done.";
        },
      });

      try {
        let result: any;
        const keysCount = getApiKeysCount();
        const maxAttempts = keysCount * 2;
        
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          let currentModelId = attempt < keysCount ? PRO_MODEL : "gemini-2.5-flash-lite";

          const agent = new Agent({
            providerId: "gemini",
            modelId: currentModelId,
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
1. **RETAIN EVERYTHING**: Your \`update_file\` MUST contain the ENTIRE modified file contents, including all original styling, classes, and logic! NEVER delete existing functionality or styling unless explicitly asked. If you output a stub or a stripped-down version, the app will look ugly and break!
2. **ARCHITECTURE**: Use standard clean React architecture: \`/components\`, \`/pages\`, \`/hooks\`, \`/lib\`. Entry point MUST be \`/App.js\` with a default export. NO TypeScript.
3. **RICH AESTHETICS & UI/UX**: You MUST build premium, state-of-the-art designs. Use modern web design best practices (vibrant colors, glassmorphism, soft shadows, rounded corners). The user should be WOWED at first glance.
4. **DYNAMIC ANIMATIONS**: Use \`framer-motion\` to add micro-interactions, page transitions, and hover effects. An interface that feels alive encourages interaction.
5. **COMPLETENESS**: DO NOT stub out files or use placeholders like \`// implement later\`. Write fully-featured, production-ready code. Always write complete file contents.
6. **STYLING**: Use Tailwind CSS for all styling. Rely on utility classes exclusively.
7. **DATABASE**: If modifying data fetching, use a data abstraction layer (e.g. \`/lib/db.js\`). Check if \`process.env.REACT_APP_MONGODB_DATA_API_KEY\` exists to use Atlas, else simulate with \`localStorage\`.
8. **DEPLOYMENT**: Keep \`/README.md\` updated with instructions for running and deploying to Vercel.
9. **IMAGES**: NEVER use local image paths. ALWAYS use: https://image.pollinations.ai/prompt/{keyword}?width=800&height=600&nologo=true or https://placehold.co/600x400/png
10. **MOBILE-FIRST**: You MUST design the application to be highly responsive and adapt gracefully to mobile screens.
11. **LIGHT MODE DEFAULT**: Design in light mode by default unless requested otherwise.
12. **NO ORPHANED CSS**: Our boilerplate imports \`./styles.css\` globally. DO NOT import \`./index.css\` or \`./App.css\`.`,
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
              if (attempt < maxAttempts - 1) {
                console.warn("[improve] Agent failed, falling back to next model/key...");
                rotateApiKey();
                continue;
              }
              throw new Error(result.error?.message ?? "Agent run failed");
            }
            
            // Successfully finished run
            break;
          } catch (err: any) {
            if (attempt < maxAttempts - 1) {
              console.warn("[improve] Agent exception, falling back to next model/key...");
              rotateApiKey();
              continue;
            }
            throw err;
          }
        }

        // Auto-extract new dependencies from code to prevent Agent forgetfulness
        const extracted = extractDependencies(patchedFiles);
        const finalDependencies = { ...(fileData.dependencies ?? {}) };
        
        extracted.forEach(pkg => {
          if (!finalDependencies[pkg]) finalDependencies[pkg] = "latest";
        });
        
        // Merge with BASE_DEPENDENCIES to ensure stable versions win
        const mergedDeps = {
          ...finalDependencies,
          ...BASE_DEPENDENCIES
        };

        // Remove problematic packages that crash Sandpack
        delete mergedDeps["tailwindcss"];
        delete mergedDeps["postcss"];
        delete mergedDeps["autoprefixer"];
        delete mergedDeps["react"];
        delete mergedDeps["react-dom"];

        const newFileData: FileData = {
          files: patchedFiles,
          dependencies: mergedDeps,
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
