"use server";

import { getSession } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { connectDB } from "@/lib/mongodb";
import User from "@/lib/models/User";
import Workspace from "@/lib/models/Workspace";
import mongoose from "mongoose";
import type { ProjectSummary } from "@/types/project";

export type { ProjectSummary } from "@/types/project";

// ─── Get all workspaces for the current user ──────────────────────────────────

export async function getUserProjects(): Promise<ProjectSummary[]> {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  await connectDB();

  const user = await User.findById(session.userId).select("_id");
  if (!user) redirect("/sign-in");

  const workspaces = await Workspace.find({ userId: user._id })
    .select("_id title messages createdAt updatedAt")
    .sort({ updatedAt: -1 })
    .lean();

  return workspaces.map((w) => {
    const msgs = Array.isArray(w.messages) ? w.messages : [];
    const firstUserMsg = msgs.find(
      (m): m is { role: string; content: string } =>
        typeof m === "object" &&
        m !== null &&
        (m as Record<string, unknown>).role === "user"
    );

    return {
      id: (w._id as mongoose.Types.ObjectId).toString(),
      title: w.title ?? null,
      firstPrompt: firstUserMsg?.content?.slice(0, 120) ?? null,
      createdAt: w.createdAt,
      updatedAt: w.updatedAt,
      messageCount: Array.isArray(w.messages) ? w.messages.length : 0,
    };
  });
}

// ─── Delete a workspace ───────────────────────────────────────────────────────

export async function deleteProject(workspaceId: string): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  await connectDB();

  const user = await User.findById(session.userId).select("_id");
  if (!user) redirect("/sign-in");

  await Workspace.deleteOne({
    _id: workspaceId,
    userId: user._id,
  });

  revalidatePath("/projects");
}
