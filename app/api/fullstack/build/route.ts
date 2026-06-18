import { getSession } from "@/lib/auth";
import { NextRequest } from "next/server";
import { connectDB } from "@/lib/mongodb";
import User from "@/lib/models/User";
import Workspace from "@/lib/models/Workspace";
import { generateContentStream, DEFAULT_MODEL, PRO_MODEL } from "@/lib/gemini";
import type { TaskGraph, Task, FullstackFileData } from "@/types/fullstack";
import mongoose from "mongoose";

// ─── Credit costs ─────────────────────────────────────────────────────────────

const CREDIT_COST_BUILD_STARTER = 3;
const CREDIT_COST_BUILD_PRO = 5;

// ─── SSE helper ───────────────────────────────────────────────────────────────

function sseEvent(type: string, payload: object): string {
  return `data: ${JSON.stringify({ type, ...payload })}\n\n`;
}

// ─── Topological sort ─────────────────────────────────────────────────────────

function topologicalSort(tasks: Task[]): Task[][] {
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const inDegree = new Map(tasks.map((t) => [t.id, 0]));
  const adjList = new Map(tasks.map((t) => [t.id, [] as string[]]));

  for (const task of tasks) {
    for (const dep of task.dependsOn) {
      adjList.get(dep)?.push(task.id);
      inDegree.set(task.id, (inDegree.get(task.id) ?? 0) + 1);
    }
  }

  const layers: Task[][] = [];
  let frontier = tasks.filter((t) => (inDegree.get(t.id) ?? 0) === 0);

  while (frontier.length > 0) {
    layers.push(frontier);
    const nextFrontier: Task[] = [];
    for (const task of frontier) {
      for (const childId of adjList.get(task.id) ?? []) {
        const newDeg = (inDegree.get(childId) ?? 0) - 1;
        inDegree.set(childId, newDeg);
        if (newDeg === 0) {
          const childTask = taskMap.get(childId);
          if (childTask) nextFrontier.push(childTask);
        }
      }
    }
    frontier = nextFrontier;
  }

  return layers;
}

// ─── System prompt for Code Agent ─────────────────────────────────────────────

function buildCodeAgentPrompt(
  task: Task,
  taskGraph: TaskGraph,
  existingFiles: Record<string, string>
): string {
  const existingFileList = Object.keys(existingFiles).join("\n");
  return `You are an expert Next.js 14 developer. Generate the source code for a specific task in a larger app.

APP CONTEXT:
- App name: ${taskGraph.appName}
- Description: ${taskGraph.description}
- Framework: Next.js 14 with App Router
- Database: NeDB (@seald-io/nedb) — MongoDB-compatible embedded DB, store data files at data/<collection>.db
- Styling: Tailwind CSS

YOUR TASK:
- Task name: ${task.name}
- Task description: ${task.description}
- Task type: ${task.type}
- Files to generate: ${task.files.join(", ")}

ALREADY GENERATED FILES (do not regenerate these, but you may reference them):
${existingFileList || "(none yet)"}

RULES:
1. Generate EVERY file listed in "Files to generate" — do not skip any.
2. Use NeDB for all database operations. Example pattern:
   \`\`\`js
   import Datastore from '@seald-io/nedb';
   import path from 'path';
   const db = new Datastore({ filename: path.join(process.cwd(), 'data/users.db'), autoload: true });
   \`\`\`
3. Use "use client" directive only when the component needs browser APIs or React hooks.
4. For API routes (app/api/**), use Next.js Route Handler format with NextRequest/NextResponse.
5. Use Tailwind CSS classes for all styling. Include a dark, modern design.
6. For package.json, include: ${JSON.stringify(taskGraph.dependencies)}
7. For next.config.js (if generated), DO NOT include any external package configs.
8. Always generate valid, complete, runnable TypeScript/JavaScript code.
9. For the root layout (app/layout.tsx), import globals.css.

OUTPUT: Return ONLY a JSON object mapping file paths to their complete source code.
No markdown fences. No explanation. Just the JSON.

Format:
{
  "app/layout.tsx": "...complete file content...",
  "app/globals.css": "...complete file content..."
}`;
}

// ─── Generate one task's files via Gemini ─────────────────────────────────────

async function generateTaskFiles(
  task: Task,
  taskGraph: TaskGraph,
  existingFiles: Record<string, string>,
  isPro: boolean
): Promise<Record<string, string>> {
  const prompt = buildCodeAgentPrompt(task, taskGraph, existingFiles);

  const geminiStream = await generateContentStream({
    model: isPro ? PRO_MODEL : DEFAULT_MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      responseMimeType: "application/json",
    },
  });

  let accumulated = "";
  for await (const chunk of geminiStream) {
    for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
      if (!part.thought && part.text) {
        accumulated += part.text;
      }
    }
  }

  try {
    return JSON.parse(accumulated) as Record<string, string>;
  } catch {
    console.error(`[fullstack/build] Failed to parse files for task ${task.id}`);
    return {};
  }
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session)
    return Response.json({ message: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { userId, workspaceId, taskGraph } = body as {
    userId: string;
    workspaceId?: string;
    taskGraph: TaskGraph;
  };

  if (userId !== session.userId)
    return Response.json({ message: "Unauthorized" }, { status: 401 });

  await connectDB();

  const user = await User.findById(userId).select("_id credits plan");
  if (!user)
    return Response.json({ message: "User not found" }, { status: 404 });

  if (user.plan === "free")
    return Response.json(
      { message: "Upgrade to Starter or Pro to use Fullstack mode" },
      { status: 403 }
    );

  const isPro = user.plan === "pro";
  const creditCost = isPro ? CREDIT_COST_BUILD_PRO : CREDIT_COST_BUILD_STARTER;

  if (user.credits < creditCost)
    return Response.json({ message: "Insufficient credits" }, { status: 402 });

  // ── Stream build ────────────────────────────────────────────────────────────

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (chunk: string) =>
        controller.enqueue(encoder.encode(chunk));

      try {
        const layers = topologicalSort(taskGraph.tasks);
        const allFiles: Record<string, string> = {};

        enqueue(
          sseEvent("status", {
            message: `Building ${taskGraph.appName} in ${layers.length} stage(s)…`,
          })
        );

        for (let layerIdx = 0; layerIdx < layers.length; layerIdx++) {
          const layer = layers[layerIdx];

          enqueue(
            sseEvent("status", {
              message: `Stage ${layerIdx + 1}/${layers.length}: generating ${layer.map((t) => t.name).join(", ")}…`,
            })
          );

          // Run all tasks in this layer in parallel
          await Promise.all(
            layer.map(async (task) => {
              enqueue(
                sseEvent("task_started", {
                  taskId: task.id,
                  taskName: task.name,
                })
              );

              try {
                const files = await generateTaskFiles(
                  task,
                  taskGraph,
                  allFiles,
                  isPro
                );

                for (const [path, code] of Object.entries(files)) {
                  allFiles[path] = code;
                  enqueue(sseEvent("file_written", { path, taskId: task.id }));
                }

                enqueue(
                  sseEvent("task_done", {
                    taskId: task.id,
                    taskName: task.name,
                  })
                );
              } catch (err) {
                const message =
                  err instanceof Error ? err.message : "Unknown error";
                enqueue(
                  sseEvent("task_failed", {
                    taskId: task.id,
                    taskName: task.name,
                    error: message,
                  })
                );
              }
            })
          );
        }

        // Build the final FullstackFileData payload
        const fileData: FullstackFileData = {
          files: allFiles,
          dependencies: {
            ...taskGraph.dependencies,
            "@seald-io/nedb": "^4.0.4",
          },
          devDependencies: taskGraph.devDependencies ?? {},
          startCommand: taskGraph.startCommand ?? "npm run dev",
          appName: taskGraph.appName,
        };

        // Persist to workspace
        if (workspaceId) {
          const userObjectId = new mongoose.Types.ObjectId(userId);
          await Workspace.findOneAndUpdate(
            { _id: workspaceId, userId: userObjectId },
            { "fileData.fullstack": fileData }
          );
        }

        // Deduct credits
        await User.findByIdAndUpdate(userId, {
          $inc: { credits: -creditCost },
        });

        const updatedUser = await User.findById(userId).select("credits");

        enqueue(
          sseEvent("done", {
            fileData,
            creditsRemaining:
              updatedUser?.credits ?? user.credits - creditCost,
          })
        );
      } catch (err) {
        console.error("[fullstack/build] error:", err);
        enqueue(
          sseEvent("error", {
            message: err instanceof Error ? err.message : "Build failed",
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
