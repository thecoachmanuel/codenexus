import { GoogleGenAI } from "@google/genai";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
async function run() {
  const response = await ai.models.generateContent({ model: "gemini-2.5-flash", contents: "Hello" });
  console.log("text typeof:", typeof response.text);
  console.log("text:", response.text);
}
run().catch(console.error);
