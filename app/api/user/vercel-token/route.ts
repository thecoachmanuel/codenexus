import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import User from "@/lib/models/User";

// POST — save Vercel token
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const { token } = await req.json() as { token: string };
  if (!token?.trim()) return NextResponse.json({ message: "Token is required" }, { status: 400 });

  // Quick validation: call Vercel API to confirm token works
  const vercelRes = await fetch("https://api.vercel.com/v2/user", {
    headers: {
      Authorization: `Bearer ${token.trim()}`,
    },
  });

  if (!vercelRes.ok) {
    return NextResponse.json(
      { message: "Invalid token — could not authenticate with Vercel." },
      { status: 400 }
    );
  }

  const vercelUser = await vercelRes.json() as { user: { username: string; email: string } };

  await connectDB();
  await User.findByIdAndUpdate(session.userId, { vercelToken: token.trim() });

  return NextResponse.json({ username: vercelUser.user.username, email: vercelUser.user.email });
}

// DELETE — remove Vercel token
export async function DELETE() {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  await connectDB();
  await User.findByIdAndUpdate(session.userId, { vercelToken: "" });

  return NextResponse.json({ ok: true });
}

// GET — check if token is connected
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  await connectDB();
  const user = await User.findById(session.userId).select("vercelToken");
  if (!user?.vercelToken) return NextResponse.json({ connected: false });

  // Verify token is still valid
  const vercelRes = await fetch("https://api.vercel.com/v2/user", {
    headers: {
      Authorization: `Bearer ${user.vercelToken}`,
    },
  });

  if (!vercelRes.ok) {
    await User.findByIdAndUpdate(session.userId, { vercelToken: "" });
    return NextResponse.json({ connected: false });
  }

  const vercelUser = await vercelRes.json() as { user: { username: string; email: string } };
  return NextResponse.json({ connected: true, username: vercelUser.user.username, email: vercelUser.user.email });
}
