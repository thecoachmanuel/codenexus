import { getSession } from "@/lib/auth";
import { NextRequest } from "next/server";
import { connectDB } from "@/lib/mongodb";
import User from "@/lib/models/User";
import Workspace from "@/lib/models/Workspace";
import type { Message, FileData } from "@/types/workspace";
import mongoose from "mongoose";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { index } = body as { index: number };
    const { id } = await params;

    if (typeof index !== "number" || index < 0) {
      return Response.json({ message: "Invalid index" }, { status: 400 });
    }

    await connectDB();

    const userObjectId = new mongoose.Types.ObjectId(session.userId);
    const workspace = await Workspace.findOne({
      _id: id,
      userId: userObjectId,
    });

    if (!workspace) {
      return Response.json({ message: "Workspace not found" }, { status: 404 });
    }

    const messages = (workspace.messages as Message[]) || [];

    if (index >= messages.length) {
      return Response.json(
        { message: "Index out of bounds" },
        { status: 400 }
      );
    }

    // Keep messages up to the requested index
    // If user undoes message 3, they want to revert TO message 2's state,
    // and delete message 3, 4, 5... so the new messages array is sliced from 0 to index.
    const newMessages = messages.slice(0, index);

    // Scan backwards to find the last known fileDataSnapshot
    let targetFileData: FileData | null = null;
    for (let i = newMessages.length - 1; i >= 0; i--) {
      const msg = newMessages[i];
      if (msg.role === "assistant" && msg.fileDataSnapshot) {
        targetFileData = msg.fileDataSnapshot;
        break;
      }
    }

    // Update DB
    workspace.messages = newMessages;
    workspace.fileData = targetFileData;
    await workspace.save();

    return Response.json({
      success: true,
      messages: newMessages,
      fileData: targetFileData,
    });
  } catch (err) {
    console.error("[undo] error:", err);
    return Response.json({ message: "Internal server error" }, { status: 500 });
  }
}
