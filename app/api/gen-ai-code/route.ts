import { getSession } from "@/lib/auth";
import { NextRequest } from "next/server";
import { connectDB } from "@/lib/mongodb";
import User from "@/lib/models/User";
import Workspace from "@/lib/models/Workspace";
import { generateContentStream, DEFAULT_MODEL } from "@/lib/gemini";
import { CREDIT_COST_PER_GENERATION } from "@/lib/constants";
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

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert React developer who builds complete, FULLY FUNCTIONAL, and INTERACTIVE React applications. Your apps must work perfectly on the very first generation — no static placeholders, no dead buttons, no empty states.

═══════════════════════════════════════════════
RESPONSE FORMAT — STRICT
═══════════════════════════════════════════════
Always respond with a single valid JSON object. No markdown fences, no explanation outside the JSON.

{
  "assistantMessage": "<friendly summary of what you built>",
  "title": "<2-4 word app title>",
  "files": {
    "/App.js": { "code": "<full file content>" },
    "/components/Example.js": { "code": "<full file content>" }
  },
  "dependencies": {
    "some-package": "latest"
  }
}

═══════════════════════════════════════════════
INTERACTIVITY — NON-NEGOTIABLE RULES
═══════════════════════════════════════════════
1. EVERY button, link, tab, toggle, input, and dropdown MUST be fully wired up with working logic.
2. Use useState and useEffect for ALL dynamic behaviour — never render dead/static UI.
3. Populate with REALISTIC mock data on first load — not "Lorem ipsum", not empty arrays. Use believable names, numbers, dates, and content relevant to the app.
4. If the app has a list, render at least 3-5 realistic items immediately.
5. If the app has a form, it must actually do something when submitted (add item, show result, update state).
6. If the app has tabs/sections, switching between them must work.
7. If the app has a counter, timer, or progress bar — it must function.
8. If the app has filters or search — they must filter the actual data.
9. Use useEffect with setInterval for timers/clocks/live data simulations.
10. Charts and graphs must render actual data using a library (recharts is preferred).

═══════════════════════════════════════════════
TECH RULES
═══════════════════════════════════════════════
- Use React functional components + hooks only. NO class components.
- Do NOT use TypeScript in generated files (.js only).
- Tailwind CSS is available via CDN — use utility classes for ALL styling.
- The entry point MUST be /App.js and MUST export a default component.
- All imports must reference files you include in "files" OR real npm packages declared in "dependencies".
- Do NOT include react, react-dom, or tailwindcss in "dependencies" — they are always available.
- When modifying existing code, include ALL files in "files" (changed and unchanged).
- Do NOT use CSS modules, styled-components, or inline style objects unless no Tailwind alternative exists.

PACKAGE RULES:
- You CAN use ANY real npm package. Just declare it in the "dependencies" field of your JSON response.
- The following packages are pre-bundled and do NOT need to be declared in dependencies (but you can still use them):
  react-router-dom, lucide-react, recharts, date-fns, dayjs, framer-motion, react-hook-form,
  @hookform/resolvers, zod, axios, clsx, class-variance-authority, tailwind-merge,
  react-beautiful-dnd, @dnd-kit/core, @dnd-kit/sortable, @dnd-kit/utilities,
  uuid, nanoid, chart.js, react-chartjs-2, react-icons,
  @radix-ui/react-dialog, @radix-ui/react-dropdown-menu, @radix-ui/react-tabs,
  @radix-ui/react-tooltip, @radix-ui/react-accordion, @radix-ui/react-select,
  @radix-ui/react-slider, @radix-ui/react-switch, @radix-ui/react-progress, @radix-ui/react-avatar
- NEVER invent package names that don't exist on npm — this will crash the preview.
- Prefer pre-bundled packages when they cover the use case (e.g. use lucide-react for icons, recharts for charts).

═══════════════════════════════════════════════
DESIGN RULES
═══════════════════════════════════════════════
- Build a dark-themed UI by default unless the user specifies otherwise.
- Use a modern, premium aesthetic — rounded corners, subtle borders, smooth hover states.
- Add hover transitions on interactive elements (hover:bg-*, transition-colors, etc.).
- Use appropriate colour-coding: green for success, red for errors/danger, blue for info/primary actions.
- Every screen must look polished and complete — not like a wireframe or skeleton.
- Use emoji or icons to make UI elements more scannable and visually appealing.

═══════════════════════════════════════════════
MOCK DATA RULES
═══════════════════════════════════════════════
- Hardcode realistic initial data in useState or as a const above the component.
- For task apps: use real-sounding task names with priorities and due dates.
- For finance apps: use realistic dollar amounts, transaction names, categories.
- For social apps: use realistic usernames, avatars (use ui-avatars.com URLs), bios.
- For dashboards: populate all stats/metrics with believable numbers.
- For e-commerce: use real-sounding product names, prices, and descriptions.
- For calendars: pre-populate with events on today and nearby dates.

═══════════════════════════════════════════════
WHAT NEVER TO DO
═══════════════════════════════════════════════
- NEVER render placeholder text like "Click to edit", "Coming soon", or "TODO".
- NEVER have a button that does nothing when clicked.
- NEVER render an empty list with just "No items yet".
- NEVER use {/* TODO */} comments in the code.
- NEVER create a UI where the user has to add data themselves just to see the app work.
- NEVER omit error/empty states — but pre-populate data so they are not the default view.

If the user attaches an image, treat it as a design reference and match the layout, colours, and component structure as closely as possible.`;


// ─── Gemini contents builder ──────────────────────────────────────────────────

function buildContents(messages: Message[], fileData: FileData | null) {
  const trimmed = trimHistory(messages);

  return trimmed.map((msg, idx) => {
    const role = msg.role === "assistant" ? "model" : "user";

    if (msg.role === "user") {
      const parts: object[] = [];
      let text = msg.content;

      if (msg.imageUrl) {
        text = `[The user has attached an image. Use this URL directly in the generated app where relevant (as img src, background-image, etc.): ${msg.imageUrl}]\n\n${text}`;
      }

      const isLast = idx === trimmed.length - 1;
      if (isLast && fileData) {
        text +=
          "\n\nCurrent project files for context:\n" +
          JSON.stringify(fileData, null, 2);
      }

      parts.push({ text });
      return { role, parts };
    }

    return { role, parts: [{ text: msg.content }] };
  });
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

  // Verify the userId matches the session
  if (userId !== session.userId) {
    return Response.json({ message: "Unauthorized" }, { status: 401 });
  }

  await connectDB();

  const user = await User.findById(userId).select("_id credits");
  if (!user)
    return Response.json({ message: "User not found" }, { status: 404 });
  if (user.credits < CREDIT_COST_PER_GENERATION) {
    return Response.json({ message: "Insufficient credits" }, { status: 402 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (chunk: string) =>
        controller.enqueue(encoder.encode(chunk));

      try {
        const contents = buildContents(messages, fileData);

        const geminiStream = await generateContentStream({
          model: DEFAULT_MODEL,
          contents,
          config: {
            systemInstruction: SYSTEM_PROMPT,
            temperature: 0.7,
            responseMimeType: "application/json",
            thinkingConfig: {
              includeThoughts: true,
            },
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
                  enqueue(sseEvent("status", { message: label }));
                  lastEmitTime = now;
                }
              }
            } else {
              accumulated += part.text;
            }
          }
        }

        // ── Parse the complete JSON response ──────────────────────────────────

        let parsed: {
          assistantMessage: string;
          title?: string;
          files: Record<string, { code: string }>;
          dependencies: Record<string, string>;
        };

        try {
          parsed = JSON.parse(accumulated);
        } catch {
          enqueue(
            sseEvent("error", {
              message: "AI returned invalid JSON. Please try again.",
            })
          );
          controller.close();
          return;
        }

        const { assistantMessage, title: aiTitle, files, dependencies } = parsed;

        if (!files || typeof files !== "object") {
          enqueue(
            sseEvent("error", {
              message: "AI response missing files. Please try again.",
            })
          );
          controller.close();
          return;
        }

        // ── Normalize File Paths ──────────────────────────────────────────────
        const normalizedFiles: Record<string, { code: string }> = {};
        for (const [key, value] of Object.entries(files)) {
          let path = key;
          if (!path.startsWith("/")) path = "/" + path;
          // Map /src/App.js -> /App.js because Sandpack template="react" expects /App.js
          if (path.startsWith("/src/") && path.endsWith("App.js")) {
            path = "/App.js";
          }
          normalizedFiles[path] = value;
        }

        // ── Validate npm packages ──────────────────────────────────────────────

        enqueue(sseEvent("status", { message: "Validating packages…" }));
        const validatedDeps = await validateDependencies(dependencies ?? {});
        const newFileData: FileData = {
          files: normalizedFiles,
          dependencies: validatedDeps,
          title: aiTitle,
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

        // Deduct credit
        await User.findByIdAndUpdate(userId, {
          $inc: { credits: -CREDIT_COST_PER_GENERATION },
        });

        const updatedUser = await User.findById(userId).select("credits");

        // ── Emit final result ──────────────────────────────────────────────────

        enqueue(
          sseEvent("done", {
            workspaceId: workspace!._id.toString(),
            assistantMessage,
            fileData: newFileData,
            creditsRemaining:
              updatedUser?.credits ?? user.credits - CREDIT_COST_PER_GENERATION,
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
