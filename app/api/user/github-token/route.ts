import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import User from "@/lib/models/User";

// POST — save GitHub PAT
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const { token } = await req.json() as { token: string };
  if (!token?.trim()) return NextResponse.json({ message: "Token is required" }, { status: 400 });

  // Quick validation: call GitHub API to confirm token works
  const ghRes = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token.trim()}`,
      Accept: "application/vnd.github+json",
    },
  });

  if (!ghRes.ok) {
    return NextResponse.json(
      { message: "Invalid token — could not authenticate with GitHub." },
      { status: 400 }
    );
  }

  const ghUser = await ghRes.json() as { login: string; avatar_url: string };

  await connectDB();
  await User.findByIdAndUpdate(session.userId, { githubToken: token.trim() });

  return NextResponse.json({ login: ghUser.login, avatar: ghUser.avatar_url });
}

// DELETE — remove GitHub PAT
export async function DELETE() {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  await connectDB();
  await User.findByIdAndUpdate(session.userId, { githubToken: "" });

  return NextResponse.json({ ok: true });
}

// GET — check if token is connected
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  await connectDB();
  const user = await User.findById(session.userId).select("githubToken");
  if (!user?.githubToken) return NextResponse.json({ connected: false });

  // Verify token is still valid
  const ghRes = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${user.githubToken}`,
      Accept: "application/vnd.github+json",
    },
  });

  if (!ghRes.ok) {
    await User.findByIdAndUpdate(session.userId, { githubToken: "" });
    return NextResponse.json({ connected: false });
  }

  const ghUser = await ghRes.json() as { login: string; avatar_url: string };
  return NextResponse.json({ connected: true, login: ghUser.login, avatar: ghUser.avatar_url });
}
