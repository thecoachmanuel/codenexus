import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { generateWorkspaceTask } from "@/lib/ai/core";
import Workspace from "@/lib/models/Workspace";
import mongoose from "mongoose";
import { connectDB } from "@/lib/mongodb";

const generateCodeFunction = inngest.createFunction(
  { id: "generate-code-background" },
  { event: "app/generate-code" },
  async ({ event, step }) => {
    const { workspaceId, userId, messages, fileData, retryCount } = event.data;

    // Use step.run to encapsulate the long-running generation
    await step.run("run-ai-generation", async () => {
      await connectDB();

      // Enqueue function maps SSE events to MongoDB updates
      const enqueue = async (type: string, payload: any) => {
        // Find by ID directly (no session check needed here)
        // If workspaceId is not yet created (new project), we must create it first.
        // Wait, the original HTTP stream creates the workspace at the END of generation!
        // So for the first generation, workspaceId is null.
        // If workspaceId is null, we can't update MongoDB change streams until we create it.
        // Let's create the workspace placeholder immediately if it's null.
      };

      // We need to resolve workspaceId if it's null.
      let currentWorkspaceId = workspaceId;

      if (!currentWorkspaceId) {
        currentWorkspaceId = new mongoose.Types.ObjectId().toString();
        await Workspace.create({
          _id: new mongoose.Types.ObjectId(currentWorkspaceId),
          userId: new mongoose.Types.ObjectId(userId),
          title: "Generating...",
          subdomain: "app-" + Math.random().toString(36).substring(2, 9),
          messages,
          fileData: fileData || { files: {}, dependencies: {} },
          currentStatus: "Initializing...",
        });
      }

      // Now we have a valid workspaceId, we can enqueue updates.
      const handleEnqueue = async (type: string, payload: any) => {
        try {
          if (type === "status") {
            await Workspace.updateOne(
              { _id: currentWorkspaceId },
              { $set: { currentStatus: payload.message } }
            );
          } else if (type === "file_patch") {
            await Workspace.updateOne(
              { _id: currentWorkspaceId },
              { $set: { [`fileData.files.${payload.path}`]: { code: payload.code } } }
            );
          } else if (type === "done") {
            // "done" is mostly handled by generateWorkspaceTask saving the final doc,
            // but we can set a flag to ensure the UI knows it's fully done.
            await Workspace.updateOne(
              { _id: currentWorkspaceId },
              { $set: { currentStatus: "Generation Complete" } }
            );
          } else if (type === "error") {
            await Workspace.updateOne(
              { _id: currentWorkspaceId },
              { $push: { errorHistory: payload } }
            );
          }
        } catch (err) {
          console.error("Error updating MongoDB in background job:", err);
        }
      };

      await generateWorkspaceTask(
        { workspaceId: currentWorkspaceId, userId, messages, fileData, retryCount },
        handleEnqueue
      );
    });

    return { success: true };
  }
);

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [generateCodeFunction],
});
