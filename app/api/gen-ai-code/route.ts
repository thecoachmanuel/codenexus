import { getSession } from "@/lib/auth";
import { NextRequest } from "next/server";
import { inngest } from "@/lib/inngest/client";
import { generateWorkspaceTask } from "@/lib/ai/core";
import mongoose from "mongoose";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return Response.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { workspaceId, userId, messages, fileData, retryCount } = body;

  if (userId !== session.userId) {
    return Response.json({ message: "Unauthorized" }, { status: 401 });
  }

  if (!messages?.length) {
    return Response.json({ message: "No messages provided" }, { status: 400 });
  }

  let targetWorkspaceId = workspaceId;

  if (!targetWorkspaceId) {
    targetWorkspaceId = new mongoose.Types.ObjectId().toString();
  }

  // If Inngest is configured, dispatch the job and return 202
  if (process.env.INNGEST_EVENT_KEY) {
    await inngest.send({
      name: "app/generate-code",
      data: {
        workspaceId: targetWorkspaceId,
        userId,
        messages,
        fileData,
        retryCount,
      },
    });
    return Response.json({ message: "Accepted", isAsync: true, workspaceId: targetWorkspaceId }, { status: 202 });
  }

  // Fallback: Synchronous streaming using the core generation task
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (type: string, payload: any) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type, ...payload })}\n\n`)
        );
      };

      try {
        await generateWorkspaceTask(
          { workspaceId: targetWorkspaceId, userId, messages, fileData, retryCount },
          enqueue
        );
      } catch (err) {
        console.error("Synchronous generation error:", err);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
