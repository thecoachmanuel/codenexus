import { NextRequest } from "next/server";
import { connectDB } from "@/lib/mongodb";
import Workspace from "@/lib/models/Workspace";
import mongoose from "mongoose";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return new Response("Invalid workspace ID", { status: 400 });
  }

  await connectDB();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (event: string, data: any) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: event, ...data })}\n\n`)
        );
      };

      try {
        const workspace = await Workspace.findById(id).lean();
        if (workspace) {
          if (workspace.currentStatus) {
            enqueue("status", { message: workspace.currentStatus });
          }
          if (workspace.fileData) {
            enqueue("fileData_full", { fileData: workspace.fileData });
          }
        }
      } catch (err) {
        console.error("Error fetching initial workspace state", err);
      }

      const changeStream = Workspace.watch(
        [{ $match: { "documentKey._id": new mongoose.Types.ObjectId(id) } }],
        { fullDocument: "updateLookup" }
      );

      changeStream.on("change", (change) => {
        if (change.operationType === "update") {
          const updatedFields = change.updateDescription?.updatedFields;
          if (!updatedFields) return;

          if (updatedFields.currentStatus) {
            enqueue("status", { message: updatedFields.currentStatus });
          }

          if (updatedFields.fileData) {
            enqueue("fileData_full", { fileData: updatedFields.fileData });
          } else {
            const filePatches: Record<string, any> = {};
            let hasPatch = false;
            for (const [key, value] of Object.entries(updatedFields)) {
              if (key.startsWith("fileData.files.")) {
                const path = key.replace("fileData.files.", "");
                filePatches[path] = value;
                hasPatch = true;
              }
            }
            if (hasPatch) {
              for (const [path, fileObj] of Object.entries(filePatches)) {
                if (fileObj && typeof fileObj === "object" && "code" in fileObj) {
                  enqueue("file_patch", { path, code: fileObj.code });
                }
              }
            }
          }

          if (updatedFields.messages) {
            enqueue("messages_update", { messages: updatedFields.messages });
          }
          
          if (updatedFields.currentStatus === "Generation Complete") {
             // Inngest sets this explicitly so the client knows when to re-fetch or stop loading
             enqueue("done", { 
               workspaceId: id,
               fileData: change.fullDocument?.fileData,
               assistantMessage: change.fullDocument?.messages?.[change.fullDocument.messages.length - 1]?.content
             });
          }
        }
      });

      changeStream.on("error", (err) => {
        console.error("Change stream error:", err);
      });

      request.signal.addEventListener("abort", () => {
        changeStream.close();
      });
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
