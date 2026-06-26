import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function run() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
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
  
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        temperature: 0.9,
      },
    });
    
    console.log("Raw text:", response.text);
    const parsed = JSON.parse(response.text || "{}");
    console.log("Parsed keys:", Object.keys(parsed));
  } catch(e) {
    console.error("Error:", e);
  }
}
run();
