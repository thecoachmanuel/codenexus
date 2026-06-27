import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin-auth";
import { connectDB } from "@/lib/mongodb";
import ContactMessage from "@/lib/models/ContactMessage";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  
  try {
    const { status } = await req.json();
    if (status !== "read" && status !== "unread") {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    await connectDB();
    const updated = await ContactMessage.findByIdAndUpdate(
      id,
      { status },
      { new: true }
    );

    if (!updated) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: updated });
  } catch (error) {
    return NextResponse.json({ error: "Failed to update message" }, { status: 500 });
  }
}
