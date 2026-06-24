import { GoogleGenAI } from "@google/genai";

// ─── Collect all GEMINI_API_KEY_N env vars ────────────────────────────────────

function collectApiKeys(): string[] {
  const keys: string[] = [];
  for (let i = 1; i <= 100; i++) {
    const key = process.env[`GEMINI_API_KEY_${i}`];
    if (key) keys.push(key);
  }
  // Fallback to legacy GEMINI_API_KEY if no numbered keys found, or add it if it's unique
  if (process.env.GEMINI_API_KEY && !keys.includes(process.env.GEMINI_API_KEY)) {
    keys.push(process.env.GEMINI_API_KEY);
  }
  if (keys.length === 0) {
    throw new Error("No Gemini API keys found. Set GEMINI_API_KEY_1 in .env.local");
  }
  return keys;
}

// ─── Global round-robin index (persists across requests in the same process) ──

const globalForGemini = globalThis as unknown as { geminiKeyIndex: number };
if (typeof globalForGemini.geminiKeyIndex === "undefined") {
  globalForGemini.geminiKeyIndex = 0;
}

const API_KEYS = collectApiKeys();

import { connectDB } from "@/lib/mongodb";
import Setting from "@/lib/models/Setting";

export async function getModels() {
  try {
    await connectDB();
    const settings = await Setting.findOne();
    if (settings && settings.defaultModel && settings.proModel) {
      return { defaultModel: settings.defaultModel, proModel: settings.proModel };
    }
  } catch (err) {
    console.error("Error fetching models from settings:", err);
  }
  return { defaultModel: "gemini-2.5-flash", proModel: "gemini-2.5-pro" };
}

// ─── Get current client (sticky) ──────────────────────────────────────────────────

function getCurrentClient(): { client: GoogleGenAI; keyIndex: number } {
  const keyIndex = globalForGemini.geminiKeyIndex % API_KEYS.length;
  return { client: new GoogleGenAI({ apiKey: API_KEYS[keyIndex] }), keyIndex };
}

// ─── Generate content with automatic key rotation on 429 ─────────────────────

interface GenerateOptions {
  model?: string;
  contents: object[];
  config?: object;
}

export async function generateContentStream(options: GenerateOptions) {
  const { contents, config } = options;
  let model = options.model;
  
  if (!model) {
    const models = await getModels();
    model = models.defaultModel;
  }

  const { client } = getCurrentClient();
  // Do NOT catch and retry here. Let the error bubble up to core.ts
  // so that the UI can instantly display the rotating key status.
  return await client.models.generateContentStream({
    model: model,
    contents: contents as Parameters<typeof client.models.generateContentStream>[0]["contents"],
    config: config as Parameters<typeof client.models.generateContentStream>[0]["config"],
  });
}

// ─── For non-streaming (agent / cline SDK) ────────────────────────────────────

export async function generateContent(options: GenerateOptions) {
  const { contents, config } = options;
  let model = options.model;
  
  if (!model) {
    const models = await getModels();
    model = models.defaultModel;
  }
  
  const maxAttempts = Math.max(API_KEYS.length * 4, 10);

  let lastError: unknown;

  const tryModel = async (targetModel: string) => {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const { client, keyIndex } = getCurrentClient();
      try {
        return await client.models.generateContent({
          model: targetModel,
          contents: contents as Parameters<typeof client.models.generateContent>[0]["contents"],
          config: config as Parameters<typeof client.models.generateContent>[0]["config"],
        });
      } catch (err: unknown) {
        lastError = err;
        const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
        
        const isTransientOrRateLimit = 
          msg.includes("429") || 
          msg.includes("503") || 
          msg.includes("unavailable") || 
          msg.includes("rate limit") || 
          msg.includes("quota") ||
          msg.includes("overloaded");

        if (isTransientOrRateLimit && attempt < maxAttempts - 1) {
          const isFullCycle = (attempt + 1) % API_KEYS.length === 0;
          const delayMs = isFullCycle ? 10000 : 2000;
          
          console.warn(`[gemini] Key ${keyIndex + 1} rate-limited on ${targetModel} (non-stream). Waiting ${delayMs}ms...`);
          await new Promise(r => setTimeout(r, delayMs));
          
          globalForGemini.geminiKeyIndex = (keyIndex + 1) % API_KEYS.length;
          continue;
        }
        break;
      }
    }
    return null;
  };

  let response = await tryModel(model as string);
  if (response) return response;



  throw lastError ?? new Error("All Gemini API keys failed or the models are currently unavailable.");
}

export function getGeminiClient(): GoogleGenAI {
  const { client } = getCurrentClient();
  return client;
}

export function getApiKey(): string {
  const keyIndex = globalForGemini.geminiKeyIndex % API_KEYS.length;
  return API_KEYS[keyIndex];
}

export function rotateApiKey(): void {
  globalForGemini.geminiKeyIndex = (globalForGemini.geminiKeyIndex + 1) % API_KEYS.length;
}

export function getApiKeysCount(): number {
  return API_KEYS.length;
}
