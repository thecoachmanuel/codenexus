import { GoogleGenAI } from "@google/genai";

// ─── Collect all GEMINI_API_KEY_N env vars ────────────────────────────────────

function collectApiKeys(): string[] {
  const keys: string[] = [];
  let i = 1;
  while (true) {
    const key = process.env[`GEMINI_API_KEY_${i}`];
    if (!key) break;
    keys.push(key);
    i++;
  }
  // Fallback to legacy GEMINI_API_KEY if no numbered keys found
  if (keys.length === 0 && process.env.GEMINI_API_KEY) {
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
export const PRO_MODEL = "gemini-2.0-pro-exp-02-05";

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
  const maxAttempts = API_KEYS.length;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { client, keyIndex } = getCurrentClient();
    try {
      return await client.models.generateContentStream({
        model,
        contents: contents as Parameters<typeof client.models.generateContentStream>[0]["contents"],
        config: config as Parameters<typeof client.models.generateContentStream>[0]["config"],
      });
    } catch (err: unknown) {
      const isRateLimit =
        err instanceof Error &&
        (err.message.includes("429") ||
          err.message.toLowerCase().includes("rate limit") ||
          err.message.toLowerCase().includes("quota"));

      if (isRateLimit && attempt < maxAttempts - 1) {
        console.warn(`[gemini] Key ${keyIndex + 1} rate-limited, rotating to next key...`);
        // Rotate to the next key permanently for this process
        globalForGemini.geminiKeyIndex = (keyIndex + 1) % API_KEYS.length;
        continue;
      }
      throw err;
    }
  }
  throw new Error("All Gemini API keys are rate-limited. Please try again later.");
}

// ─── For non-streaming (agent / cline SDK) ────────────────────────────────────

export function getGeminiClient(): GoogleGenAI {
  const { client } = getCurrentClient();
  return client;
}

export function getApiKey(): string {
  const keyIndex = globalForGemini.geminiKeyIndex % API_KEYS.length;
  return API_KEYS[keyIndex];
}
