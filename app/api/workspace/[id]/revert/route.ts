import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import Workspace from "@/lib/models/Workspace";
import { getSession } from "@/lib/auth";
import mongoose from "mongoose";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: workspaceId } = await params;
    if (!workspaceId) {
      return NextResponse.json({ error: "Workspace ID is required" }, { status: 400 });
    }

    const { fileData, messages } = await req.json();

    if (!fileData) {
      return NextResponse.json({ error: "fileData is required" }, { status: 400 });
    }

    await connectDB();

    const workspace = await Workspace.findOne({
      _id: new mongoose.Types.ObjectId(workspaceId),
      userId: new mongoose.Types.ObjectId(session.userId),
    });
    
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found or unauthorized" }, { status: 404 });
    }

    workspace.fileData = fileData;
    if (messages) workspace.messages = messages;

    await workspace.save();

    return NextResponse.json({ success: true, workspaceId });
  } catch (error) {
    console.error("[Workspace Revert API Error]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
