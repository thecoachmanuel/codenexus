import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin-auth";
import { connectDB } from "@/lib/mongodb";
import ContactMessage from "@/lib/models/ContactMessage";

export async function GET(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await connectDB();
  
  try {
    const messages = await ContactMessage.find().sort({ createdAt: -1 }).lean();
    return NextResponse.json({ messages });
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 });
  }
}
