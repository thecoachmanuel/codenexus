import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import User from "@/lib/models/User";
import Workspace from "@/lib/models/Workspace";
import type { FileData } from "@/types/workspace";
import { VITE_REACT_BOILERPLATE } from "@/lib/constants";

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

  // 1. Prepare files for Vercel (Create React App structure)
  const vercelFiles: { file: string; data: string }[] = [];

  // Base boilerplate files
  const baseFiles: Record<string, { code: string }> = { ...VITE_REACT_BOILERPLATE };
  
  // Merge AI files
  for (const [path, val] of Object.entries(fileData.files)) {
    baseFiles[path] = val;
  }

  // Construct package.json with react-scripts
  const dependencies = {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-scripts": "^5.0.1",
    "lucide-react": "^0.263.1",
    "recharts": "^2.10.3",
    "framer-motion": "^10.16.16",
    "@emotion/is-prop-valid": "^1.2.2",
    "clsx": "^2.1.0",
    "tailwind-merge": "^2.2.0",
    ...(fileData.dependencies ?? {})
  };

  const packageJson = {
    name: (appTitle || "ai-app").toLowerCase().replace(/[^a-z0-9-]/g, "-"),
    version: "1.0.0",
    private: true,
    dependencies,
    scripts: {
      "start": "react-scripts start",
      "build": "react-scripts build"
    }
  };

  vercelFiles.push({
    file: "package.json",
    data: JSON.stringify(packageJson, null, 2)
  });

  // Map all files to CRA structure (src/ and public/)
  for (const [path, val] of Object.entries(baseFiles)) {
    if (path === "/package.json") continue; // already handled
    
    let destPath = path.startsWith("/") ? path.slice(1) : path;
    
    if (destPath === "public/index.html") {
      vercelFiles.push({ file: destPath, data: val.code });
    } else {
      // Move everything else into src/
      if (!destPath.startsWith("src/")) {
        destPath = `src/${destPath}`;
      }
      vercelFiles.push({ file: destPath, data: val.code });
    }
  }

  // Inject Tailwind config if not present, but wait, we use CDN in index.html!
  // If we use CDN in index.html, CRA build will still work because it just injects the script.
  // Actually, CRA requires tailwind config if we use local classes, but CDN is fine.
  
  // Create deployment payload
  // If we already have a deployed Vercel project for this workspace, use its name to push an update
  const projectName = workspace?.vercel?.projectName || 
    (appTitle || "ai-app-deployment").toLowerCase().replace(/[^a-z0-9-]/g, "-").substring(0, 50);

  // Vercel deployment payload
  const deployPayload = {
    name: projectName,
    files: vercelFiles,
    projectSettings: {
      framework: "create-react-app"
    }
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
