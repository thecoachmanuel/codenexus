import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getGeminiClient, DEFAULT_MODEL } from "@/lib/gemini";

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { prompt } = await req.json();

    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json({ error: "Invalid prompt" }, { status: 400 });
    }

    const systemPrompt = `You are an expert prompt engineer for an AI app builder. The user has provided a short, basic idea for a web application. Your task is to enhance it into a detailed, comprehensive prompt that describes the app's features, layout, and UI/UX. Do not output anything except the enhanced prompt text itself. Make it exciting and highly descriptive, specifying things like "modern design", "Tailwind CSS", animations, layout structure, responsive design, etc. Limit it to 3-4 concise sentences. Do not include quotes around the output.`;

    const client = getGeminiClient();
    const response = await client.models.generateContent({
      model: DEFAULT_MODEL,
      contents: [
        { role: "user", parts: [{ text: systemPrompt + "\n\nUser idea: " + prompt }] }
      ]
    });

    return NextResponse.json({ enhancedPrompt: response.text });
  } catch (error: any) {
    console.error("Error enhancing prompt:", error);
    return NextResponse.json(
      { error: "Failed to enhance prompt" },
      { status: 500 }
    );
  }
}
