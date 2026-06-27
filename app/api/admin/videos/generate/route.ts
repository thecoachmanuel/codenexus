import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { getAdminSession } from "@/lib/admin-auth";

export async function POST(req: NextRequest) {
  try {
    const session = await getAdminSession();

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectDB();

    const { prompt } = await req.json();

    if (!prompt) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }

    const systemPrompt = `You are a viral TikTok video creator. Generate a short, engaging video script based on this topic: "${prompt}".
Return ONLY valid JSON in this exact format, with no markdown formatting or extra text:
{
  "title": "A catchy video title",
  "scenes": [
    {
      "narration": "What the voiceover will say in this scene.",
      "imagePrompt": "A highly detailed, cinematic prompt for an AI image generator describing the visual for this scene. Make it vivid and descriptive. Do not include text in the image."
    }
  ]
}
Ensure there are exactly 4 to 6 scenes. Keep the narration punchy and fast-paced.`;

    // Use Pollinations Text API (which is a free LLM wrapper)
    const pollinationsUrl = `https://text.pollinations.ai/prompt/${encodeURIComponent(systemPrompt)}?json=true`;

    const response = await fetch(pollinationsUrl, {
      method: "GET",
      headers: {
        "Accept": "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`Pollinations API error: ${response.statusText}`);
    }

    let dataText = await response.text();
    
    // Clean up if it returned markdown json
    if (dataText.startsWith("```json")) {
      dataText = dataText.replace(/^```json\n/, "").replace(/\n```$/, "");
    }
    if (dataText.startsWith("```")) {
      dataText = dataText.replace(/^```\n/, "").replace(/\n```$/, "");
    }

    const parsedData = JSON.parse(dataText);

    if (!parsedData.scenes || !Array.isArray(parsedData.scenes)) {
      throw new Error("Invalid format returned from AI");
    }

    return NextResponse.json(parsedData);
  } catch (error: any) {
    console.error("Video Generation Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to generate video script" },
      { status: 500 }
    );
  }
}
