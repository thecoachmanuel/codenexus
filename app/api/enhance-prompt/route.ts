import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { generateContent, getModels } from "@/lib/gemini";

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

    const systemPrompt = `You are an expert prompt engineer for an AI app builder. The user has provided a basic idea for a web application. Your task is to enhance it into a detailed, comprehensive prompt that forces the AI to build an app with ultra-premium modern aesthetics. You MUST explicitly instruct the AI to use "micro-interactions", "professional modern typography (e.g., Inter or Outfit)", "curated harmonious color palettes (no generic red/blue/green)", "smooth hover effects", "dynamic page transitions", and "premium layout structures like glassmorphism or sleek dark modes". Describe the app's core features alongside these strict UI/UX requirements. Do not output anything except the enhanced prompt text itself. Limit it to 3-4 concise sentences. Do not include quotes around the output.`;

    const models = await getModels();

    const response = await generateContent({
      model: models.defaultModel,
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
