import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

// Simple image upload endpoint that accepts a file and returns a base64 data URL.
// This replaces Supabase Storage — no extra services needed.
// For production, you can swap this for Cloudinary/S3 by changing only this route.

const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ message: "No file provided" }, { status: 400 });
    }

    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ message: "Only images are allowed" }, { status: 400 });
    }

    if (file.size > MAX_SIZE_BYTES) {
      return NextResponse.json({ message: "Image must be under 5 MB" }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const base64 = Buffer.from(bytes).toString("base64");
    const dataUrl = `data:${file.type};base64,${base64}`;

    return NextResponse.json({ url: dataUrl });
  } catch (err) {
    console.error("[upload]", err);
    return NextResponse.json({ message: "Upload failed" }, { status: 500 });
  }
}
