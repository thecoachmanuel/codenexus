import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import ContactMessage from "@/lib/models/ContactMessage";

export async function POST(req: NextRequest) {
  try {
    const { name, email, subject, message } = await req.json();

    if (!name || !email || !subject || !message) {
      return NextResponse.json({ error: "All fields are required" }, { status: 400 });
    }

    // Basic email regex
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
    }

    await connectDB();

    const newMessage = await ContactMessage.create({
      name,
      email,
      subject,
      message,
    });

    return NextResponse.json({ success: true, messageId: newMessage._id }, { status: 201 });
  } catch (error) {
    console.error("Error submitting contact form:", error);
    return NextResponse.json({ error: "Failed to submit message" }, { status: 500 });
  }
}
