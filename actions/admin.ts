"use server";

import { getAdminSession } from "@/lib/admin-auth";

export async function checkIsAdmin(): Promise<boolean> {
  const session = await getAdminSession();
  return !!session;
}

export async function generateNewPromptSuggestions() {
  const session = await getAdminSession();
  if (!session) throw new Error("Unauthorized");

  const { generateContent } = await import("@/lib/gemini");
  const { connectDB } = await import("@/lib/mongodb");
  const Setting = (await import("@/lib/models/Setting")).default;

  await connectDB();

  const prompt = `You are a creative product manager for a tool that instantly turns natural language prompts into working React applications.
Generate a diverse set of modern, exciting web application ideas that users could ask the AI to build. Include SaaS ideas, consumer apps, interactive dashboards, etc.
Output strictly as a valid JSON object matching this interface:
{
  "suggestions": [
    ["idea 1", "idea 2", "idea 3", "idea 4", "idea 5", "idea 6"],
    ["idea 1", "idea 2", "idea 3", "idea 4", "idea 5", "idea 6"],
    ["idea 1", "idea 2", "idea 3", "idea 4", "idea 5", "idea 6"]
  ],
  "placeholders": [
    "idea 1 with trailing ellipsis...",
    "idea 2 with trailing ellipsis...",
    "idea 3 with trailing ellipsis...",
    "idea 4 with trailing ellipsis...",
    "idea 5 with trailing ellipsis..."
  ]
}`;

  const response = await generateContent({
    model: "gemini-2.5-flash",
    contents: prompt as any,
    config: {
      responseMimeType: "application/json",
      temperature: 0.9,
    },
  });

  const rawText = response.text || "{}";
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error("Failed to parse AI response.");
  }

  if (!parsed.suggestions || !parsed.placeholders) {
    throw new Error("Invalid format from AI.");
  }

  let setting = await Setting.findOne();
  if (!setting) {
    setting = new Setting({});
  }

  setting.aiSuggestions = parsed.suggestions;
  setting.aiPlaceholders = parsed.placeholders;
  await setting.save();

  return true;
}
