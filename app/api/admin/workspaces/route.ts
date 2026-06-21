import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin-auth";
import { connectDB } from "@/lib/mongodb";
import Workspace from "@/lib/models/Workspace";
import User from "@/lib/models/User";
import mongoose from "mongoose";

// GET - List all workspaces with owner info
export async function GET(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await connectDB();
  const url = new URL(req.url);
  const page = parseInt(url.searchParams.get("page") || "1");
  const limit = parseInt(url.searchParams.get("limit") || "20");
  const search = url.searchParams.get("search") || "";
  const skip = (page - 1) * limit;

  const matchStage: Record<string, unknown> = {};
  if (search) matchStage.title = { $regex: search, $options: "i" };

  const [workspaces, total] = await Promise.all([
    Workspace.aggregate([
      { $match: matchStage },
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: limit },
      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "owner",
          pipeline: [{ $project: { name: 1, email: 1 } }],
        },
      },
      { $unwind: { path: "$owner", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          title: 1,
          createdAt: 1,
          updatedAt: 1,
          "owner.name": 1,
          "owner.email": 1,
        },
      },
    ]),
    Workspace.countDocuments(matchStage),
  ]);

  return NextResponse.json({ workspaces, total, page, limit });
}

// DELETE - Delete a workspace by ID or all workspaces
export async function DELETE(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { workspaceId, deleteAll } = await req.json();

  await connectDB();

  if (deleteAll) {
    await Workspace.deleteMany({});
    return NextResponse.json({ success: true, deletedAll: true });
  }

  if (!workspaceId) return NextResponse.json({ error: "Missing workspaceId" }, { status: 400 });

  await Workspace.findByIdAndDelete(new mongoose.Types.ObjectId(workspaceId));

  return NextResponse.json({ success: true });
}
