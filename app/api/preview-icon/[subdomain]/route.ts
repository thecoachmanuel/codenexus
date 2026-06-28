import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import Workspace from "@/lib/models/Workspace";
import type { FileData } from "@/types/workspace";

export async function GET(req: Request, context: { params: Promise<{ subdomain: string }> }) {
  try {
    const { subdomain } = await context.params;
    await connectDB();
    
    const workspace = await Workspace.findOne({ subdomain }).lean();
    if (!workspace) {
      return new NextResponse("Not Found", { status: 404 });
    }

    const fileData = workspace.fileData as FileData;
    const files = fileData?.files || {};

    // Try to find a logo or favicon in the generated files
    const possibleLogos = [
      "/public/logo.svg",
      "/public/favicon.svg",
      "/public/vite.svg",
      "/src/logo.svg",
      "/src/assets/logo.svg"
    ];

    let svgContent = null;
    for (const path of possibleLogos) {
      if (files[path] && files[path].code) {
        svgContent = files[path].code;
        break;
      }
    }

    // If no logo found, generate a simple attractive text logo based on the title
    if (!svgContent) {
      const title = workspace.title || "W";
      const initial = title.charAt(0).toUpperCase();
      // Generate a beautiful gradient SVG
      svgContent = `<svg width="800" height="600" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#4f46e5;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#0ea5e9;stop-opacity:1" />
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#grad)" rx="0" />
        <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="system-ui, sans-serif" font-size="250" font-weight="bold" fill="#ffffff">${initial}</text>
      </svg>`;
    }

    return new NextResponse(svgContent, {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (err) {
    console.error("Error serving preview icon:", err);
    return new NextResponse("Error", { status: 500 });
  }
}
