import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import User from "@/lib/models/User";
import Workspace from "@/lib/models/Workspace";
import type { FileData } from "@/types/workspace";
import { FULLSTACK_BOILERPLATE } from "@/lib/constants";
// ...
  const baseFiles: Record<string, { code: string }> = { ...FULLSTACK_BOILERPLATE };

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const { fileData, appTitle, workspaceId } = (await req.json()) as { fileData: FileData; appTitle: string; workspaceId?: string };
  if (!fileData || !fileData.files) {
    return NextResponse.json({ message: "No files to deploy" }, { status: 400 });
  }

  await connectDB();
  const user = await User.findById(session.userId).select("vercelToken");
  
  if (!user?.vercelToken) {
    return NextResponse.json({ message: "Vercel token not configured" }, { status: 400 });
  }

  // Fetch workspace to check for existing deployment
  let workspace = null;
  if (workspaceId) {
    workspace = await Workspace.findOne({ _id: workspaceId, userId: user._id });
  }

  // 1. Prepare files for Vercel
  const vercelFiles: { file: string; data: string }[] = [];

  // Merge AI files
  for (const [path, val] of Object.entries(fileData.files)) {
    if (!val || typeof val.code !== "string") continue;
    
    // Vercel deployment API expects paths without leading slash
    const destPath = path.startsWith("/") ? path.slice(1) : path;
    vercelFiles.push({ file: destPath, data: val.code });
  }

  // If no package.json is provided by AI, add a minimal one so it deploys as Node.js or static
  if (!vercelFiles.find(f => f.file === "package.json")) {
    vercelFiles.push({
      file: "package.json",
      data: JSON.stringify({
        name: (appTitle || "ai-app").toLowerCase().replace(/[^a-z0-9-]/g, "-"),
        version: "1.0.0",
        private: true,
        scripts: { start: "node index.js" }
      }, null, 2)
    });
  }

  // Create deployment payload
  const projectName = workspace?.vercel?.projectName || 
    (appTitle || "ai-app-deployment").toLowerCase().replace(/[^a-z0-9-]/g, "-").substring(0, 50);

  // Vercel deployment payload (Vercel auto-detects the framework)
  const deployPayload = {
    name: projectName,
    files: vercelFiles,
    projectSettings: {}
  };

  try {
    const response = await fetch("https://api.vercel.com/v13/deployments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${user.vercelToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(deployPayload)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Vercel deployment failed:", data);
      return NextResponse.json({ 
        message: data.error?.message || "Vercel deployment failed" 
      }, { status: response.status });
    }

    const url = `https://${data.url}`;
    
    // Save to workspace if it exists
    if (workspace) {
      workspace.vercel = {
        projectId: data.id, // Using deployment ID or we can just save it
        projectName: projectName,
        url: url,
        deployedAt: new Date()
      };
      await workspace.save();
    }

    return NextResponse.json({
      url,
      deploymentId: data.id,
      name: projectName
    });

  } catch (error) {
    console.error("Deploy error:", error);
    return NextResponse.json({ message: "Internal server error during deployment" }, { status: 500 });
  }
}
