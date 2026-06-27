import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import Workspace from "@/lib/models/Workspace";

const RESERVED_SUBDOMAINS = ["www", "api", "admin", "app", "support", "help", "docs", "blog", "mail", "ftp", "dev", "test"];

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await req.json();
    let { subdomain } = body;

    if (!subdomain || typeof subdomain !== "string") {
      return NextResponse.json({ error: "Subdomain is required" }, { status: 400 });
    }

    subdomain = subdomain.toLowerCase().trim();

    // Format validation: alphanumeric and hyphens, 3-30 chars, no leading/trailing hyphens
    const isValidFormat = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(subdomain);
    if (!isValidFormat) {
      return NextResponse.json({ 
        error: "Subdomain must be 3-30 characters long, and can only contain lowercase letters, numbers, and hyphens (cannot start or end with a hyphen)." 
      }, { status: 400 });
    }

    if (RESERVED_SUBDOMAINS.includes(subdomain)) {
      return NextResponse.json({ error: "This subdomain is reserved." }, { status: 400 });
    }

    await connectDB();

    // Ensure the user owns the workspace
    const workspace = await Workspace.findOne({ _id: id, userId: session.userId });
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    if (workspace.subdomain === subdomain) {
      return NextResponse.json({ success: true, subdomain });
    }

    // Check for uniqueness
    const existing = await Workspace.findOne({ subdomain });
    if (existing) {
      return NextResponse.json({ error: "This subdomain is already taken. Please choose another." }, { status: 409 });
    }

    workspace.subdomain = subdomain;
    await workspace.save();

    return NextResponse.json({ success: true, subdomain });
  } catch (error) {
    console.error("Failed to update subdomain:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
