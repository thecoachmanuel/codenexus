import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import Workspace from "@/lib/models/Workspace";
import User from "@/lib/models/User";

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session || !session.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.userId;
    const { id } = await context.params;
    const { title } = await req.json();

    if (!title || typeof title !== "string" || title.trim().length === 0) {
      return NextResponse.json({ error: "Invalid title" }, { status: 400 });
    }

    await connectDB();

    // Check if user is pro
    const user = await User.findById(userId).lean();
    if (!user || user.plan !== "pro") {
      return NextResponse.json({ error: "Pro plan required to rename projects" }, { status: 403 });
    }

    // Update the workspace title
    const workspace = await Workspace.findOneAndUpdate(
      { _id: id, userId: user._id },
      { $set: { title: title.trim() } },
      { new: true }
    );

    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, title: workspace.title });
  } catch (error) {
    console.error("Error renaming workspace:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
