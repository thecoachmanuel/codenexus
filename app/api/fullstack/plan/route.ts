import { getSession } from "@/lib/auth";
import { NextRequest } from "next/server";
import { connectDB } from "@/lib/mongodb";
import User from "@/lib/models/User";
import Workspace from "@/lib/models/Workspace";
import { generateContentStream, PRO_MODEL } from "@/lib/gemini";
import type { TaskGraph } from "@/types/fullstack";
import mongoose from "mongoose";

// ─── Credit costs ─────────────────────────────────────────────────────────────

export const CREDIT_COST_PLAN_STARTER = 3;
export const CREDIT_COST_PLAN_PRO = 2;

// ─── SSE helper ───────────────────────────────────────────────────────────────

function sseEvent(type: string, payload: object): string {
  return `data: ${JSON.stringify({ type, ...payload })}\n\n`;
}

// ─── System prompt for the Planner Agent ─────────────────────────────────────

const PLANNER_SYSTEM_PROMPT = `You are a senior fullstack architect. Your job is to analyse a user's app idea and produce a detailed task graph for building a complete Next.js 14 (App Router) application.

RULES:
- Framework is ALWAYS Next.js 14 with App Router (app/ directory).
- For data persistence, ALWAYS use NeDB (@seald-io/nedb). NeDB has a MongoDB-compatible API (same find/insert/update/remove) but is a pure-JS embedded database — no external connection needed. Store DB files at data/<collection>.db inside the project.
- Never use real MongoDB, Prisma, or any native binary database.
- Use Tailwind CSS for styling.
- Break the app into 5–10 tasks max. Each task covers a logical slice (e.g. "Database layer", "Auth API routes", "Dashboard page").
- Every task must list the exact file paths it will generate.
- Tasks must declare their dependsOn array using other task ids so the executor can build in the correct order.
- Output ONLY valid JSON matching the schema — no markdown fences, no commentary.

OUTPUT SCHEMA (strict JSON):
{
  "framework": "nextjs",
  "appName": "string — PascalCase app name",
  "description": "string — one sentence description",
  "tasks": [
    {
      "id": "task_1",
      "name": "string — short task name",
      "description": "string — what this task generates",
      "type": "config|pages|api|components|lib|styles|db|test",
      "dependsOn": [],
      "files": ["app/layout.tsx", "app/globals.css"]
    }
  ],
  "dependencies": {
    "@seald-io/nedb": "^4.0.4",
    "lucide-react": "latest",
    "clsx": "latest"
  },
  "devDependencies": {
    "tailwindcss": "^3",
    "autoprefixer": "latest",
    "postcss": "latest"
  },
  "startCommand": "npm run dev",
  "hasDatabase": true
}`;

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session)
    return Response.json({ message: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { userId, workspaceId, prompt } = body as {
    userId: string;
    workspaceId?: string;
    prompt: string;
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

  const creditCost =
    user.plan === "pro" ? CREDIT_COST_PLAN_PRO : CREDIT_COST_PLAN_STARTER;

  if (user.credits < creditCost)
    return Response.json({ message: "Insufficient credits" }, { status: 402 });

  // ── Stream planning ────────────────────────────────────────────────────────

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (chunk: string) =>
        controller.enqueue(encoder.encode(chunk));

      try {
        enqueue(sseEvent("status", { message: "Planning your app…" }));

        const geminiStream = await generateContentStream({
          model: PRO_MODEL,
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }],
            },
          ],
          config: {
            systemInstruction: PLANNER_SYSTEM_PROMPT,
            responseMimeType: "application/json",
            thinkingConfig: { includeThoughts: true },
          },
        });

        let accumulated = "";
        let lastThoughtTime = 0;

        for await (const chunk of geminiStream) {
          for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
            if (part.thought && part.text) {
              const now = Date.now();
              if (now - lastThoughtTime > 500) {
                enqueue(sseEvent("status", { message: part.text.slice(0, 120) }));
                lastThoughtTime = now;
              }
            } else if (part.text) {
              accumulated += part.text;
            }
          }
        }

        let taskGraph: TaskGraph;
        try {
          taskGraph = JSON.parse(accumulated) as TaskGraph;
        } catch {
          throw new Error("Planner returned invalid JSON. Please try again.");
        }

        // Initialise task statuses
        taskGraph.tasks = taskGraph.tasks.map((t) => ({
          ...t,
          status: "pending" as const,
        }));

        // Persist task graph to workspace if workspaceId provided
        if (workspaceId) {
          const userObjectId = new mongoose.Types.ObjectId(userId);
          await Workspace.findOneAndUpdate(
            { _id: workspaceId, userId: userObjectId },
            { taskGraph }
          );
        }

        // Deduct credits
        await User.findByIdAndUpdate(userId, {
          $inc: { credits: -creditCost },
        });

        const updatedUser = await User.findById(userId).select("credits");

        enqueue(sseEvent("task_graph", { taskGraph }));
        enqueue(
          sseEvent("done", {
            taskGraph,
            creditsRemaining:
              updatedUser?.credits ?? user.credits - creditCost,
          })
        );
      } catch (err) {
        console.error("[fullstack/plan] error:", err);
        enqueue(
          sseEvent("error", {
            message:
              err instanceof Error ? err.message : "Planning failed",
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
