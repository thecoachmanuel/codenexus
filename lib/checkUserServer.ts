// lib/checkUserServer.ts
// Server-side user fetcher using JWT session + MongoDB
// Replaces lib/checkUser.ts (Clerk-based)

import { getSession } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import User from "@/lib/models/User";
import type { IUser } from "@/lib/models/User";
import mongoose from "mongoose";

export interface ServerUser {
  id: string;
  name: string;
  email: string;
  credits: number;
  plan: string;
  imageUrl: string;
}

export async function checkUserServer(): Promise<ServerUser | null> {
  const session = await getSession();
  if (!session) return null;

  try {
    await connectDB();
    const user = await User.findById(session.userId)
      .select("-password")
      .lean<IUser>();
    if (!user) return null;

    return {
      id: (user._id as mongoose.Types.ObjectId).toString(),
      name: user.name,
      email: user.email,
      credits: user.credits,
      plan: user.plan,
      imageUrl: user.imageUrl,
    };
  } catch {
    return null;
  }
}
