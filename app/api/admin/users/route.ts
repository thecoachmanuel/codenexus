import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin-auth";
import { connectDB } from "@/lib/mongodb";
import User from "@/lib/models/User";
import Workspace from "@/lib/models/Workspace";
import mongoose from "mongoose";

// GET - List all users
export async function GET(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await connectDB();
  const url = new URL(req.url);
  const page = parseInt(url.searchParams.get("page") || "1");
  const limit = parseInt(url.searchParams.get("limit") || "20");
  const search = url.searchParams.get("search") || "";
  const skip = (page - 1) * limit;

  const query = search
    ? { $or: [{ name: { $regex: search, $options: "i" } }, { email: { $regex: search, $options: "i" } }] }
    : {};

  const [users, total] = await Promise.all([
    User.find(query).select("-password").sort({ createdAt: -1 }).skip(skip).limit(limit),
    User.countDocuments(query),
  ]);

  return NextResponse.json({ users, total, page, limit });
}

// PUT - Update a user's plan and/or credits
export async function PUT(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { userId, plan, credits, isBanned } = await req.json();
  if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 });

  await connectDB();
  const update: Record<string, unknown> = {};
  if (plan) update.plan = plan;
  if (credits !== undefined) update.credits = credits;
  if (isBanned !== undefined) update.isBanned = isBanned;

  const user = await User.findByIdAndUpdate(userId, update, { new: true }).select("-password");
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  return NextResponse.json({ user });
}

// DELETE - Delete a user and all their workspaces
export async function DELETE(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { userId } = await req.json();
  if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 });

  await connectDB();
  const objectId = new mongoose.Types.ObjectId(userId);

  await Promise.all([
    User.findByIdAndDelete(objectId),
    Workspace.deleteMany({ userId: objectId }),
  ]);

  return NextResponse.json({ success: true });
}
