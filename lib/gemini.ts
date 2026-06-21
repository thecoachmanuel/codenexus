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

export const DEFAULT_MODEL = "gemini-2.5-flash";
export const PRO_MODEL = "gemini-2.5-pro";

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
  const { model = DEFAULT_MODEL, contents, config } = options;
  // Loop multiple times to allow token buckets to refill and to survive long 503 spikes
  const maxAttempts = Math.max(API_KEYS.length * 4, 10);

  let lastError: unknown;

  const tryModel = async (targetModel: string) => {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const { client, keyIndex } = getCurrentClient();
      try {
        return await client.models.generateContentStream({
          model: targetModel,
          contents: contents as Parameters<typeof client.models.generateContentStream>[0]["contents"],
          config: config as Parameters<typeof client.models.generateContentStream>[0]["config"],
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
          const delayMs = isFullCycle ? 10000 : 2000; // Wait 10s if we exhausted all keys once, else 2s
          
          console.warn(`[gemini] Key ${keyIndex + 1} rate-limited on ${targetModel}. Waiting ${delayMs}ms before rotating...`);
          await new Promise(r => setTimeout(r, delayMs));
          
          globalForGemini.geminiKeyIndex = (keyIndex + 1) % API_KEYS.length;
          continue;
        }
        
        // If it's a hard error (e.g. 400 Bad Request) or we exhausted all attempts, break
        break;
      }
    }
    return null;
  };

  let stream = await tryModel(model);
  if (stream) return stream;



  throw lastError ?? new Error("All Gemini API keys failed or the models are currently unavailable.");
}

// ─── For non-streaming (agent / cline SDK) ────────────────────────────────────

export async function generateContent(options: GenerateOptions) {
  const { model = DEFAULT_MODEL, contents, config } = options;
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

  let response = await tryModel(model);
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
