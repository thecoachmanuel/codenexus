"use server";

import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { connectDB } from "@/lib/mongodb";
import User from "@/lib/models/User";
import Workspace from "@/lib/models/Workspace";
import mongoose from "mongoose";
import type { WorkspaceUser, WorkspaceData } from "@/types/workspace";

export type { WorkspaceUser, WorkspaceData } from "@/types/workspace";

// ─── Get the current authenticated user ──────────────────────────────────────

export async function getWorkspaceUser(): Promise<WorkspaceUser> {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  await connectDB();

  const user = await User.findById(session.userId)
    .select("_id credits plan")
    .lean();

  if (!user) redirect("/sign-in");

  return {
    id: (user._id as mongoose.Types.ObjectId).toString(),
    credits: user.credits,
    plan: user.plan,
  };
}

// ─── Get a workspace by id (must belong to the current user) ─────────────────

export async function getWorkspaceById(
  workspaceId: string,
  userId: string
): Promise<WorkspaceData> {
  await connectDB();

  const workspace = await Workspace.findOne({
    _id: workspaceId,
    userId: new mongoose.Types.ObjectId(userId),
  })
    .select("_id title subdomain messages fileData vercel")
    .lean();

  if (!workspace) redirect("/");

  return {
    id: (workspace._id as mongoose.Types.ObjectId).toString(),
    title: workspace.title ?? null,
    subdomain: workspace.subdomain,
    messages: workspace.messages,
    fileData: workspace.fileData,
    vercel: workspace.vercel as any,
  };
}
