import { getSession } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import User from "@/lib/models/User";
import Workspace from "@/lib/models/Workspace";
import { generateContent, generateContentStream, DEFAULT_MODEL, PRO_MODEL } from "@/lib/gemini";
import { calculateGenerationCost } from "@/lib/credit-calculator";
import { extractDependencies, findMissingFiles, autoFixAbsoluteImports, autoStubMissingFiles } from "@/lib/dependencies";
import { validateAST } from "@/lib/validator";
import { BASE_DEPENDENCIES, REACT_BOILERPLATE } from "@/lib/constants";
import type { Message, FileData } from "@/types/workspace";
import mongoose from "mongoose";

// ─── Extract short label from a Gemini thought chunk ─────────────────────────

function extractThoughtLabel(text: string): string | null {
  const boldMatch = text.match(/\*\*([^*]{4,60})\*\*/);
  if (boldMatch) return boldMatch[1].trim();
  const sentence = text.split(/[.\n]/)[0].trim();
  if (sentence.length >= 8 && sentence.length <= 80) return sentence;
  return null;
}

// ─── History trimming ─────────────────────────────────────────────────────────

function trimHistory(messages: Message[]): Message[] {
  if (messages.length <= 10) return messages;
  return [messages[0], ...messages.slice(-8)];
}

async function runGeminiPass(
  model: string,
  contents: object[],
  systemInstruction: string,
  onThought: (label: string) => void
): Promise<string> {
  const geminiStream = await generateContentStream({
    model: model,
    contents,
    config: {
      systemInstruction,
      temperature: 0.7,
      responseMimeType: "application/json",
    },
  });

  let accumulated = "";
  let lastEmitTime = 0;

  for await (const chunk of geminiStream) {
    const parts = chunk.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      if (!part.text) continue;
      if (part.thought) {
        const now = Date.now();
        if (now - lastEmitTime > 600) {
          const label = extractThoughtLabel(part.text);
          if (label) {
            onThought(label);
            lastEmitTime = now;
          }
        }
      } else {
        accumulated += part.text;
        const now = Date.now();
        if (now - lastEmitTime > 2000) {
          onThought(`Writing code... (${(accumulated.length / 1024).toFixed(1)} KB)`);
          lastEmitTime = now;
        }
      }
    }
  }
  return accumulated;
}

// ─── Helper: safely parse JSON with truncation recovery ──────────────────────

function safeParseJSON<T>(raw: string): T | null {
  // Fast path: clean markdown fences immediately so JSON.parse succeeds on the first try
  let cleaned = raw.trim();
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.replace(/^```json\s*/i, "").replace(/\s*```$/i, "");
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-z]*\s*/i, "").replace(/\s*```$/i, "");
  }

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // If standard parsing fails, try to extract just the JSON object
    let cleaned = raw;
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleaned = cleaned.substring(firstBrace, lastBrace + 1);
      try {
        return JSON.parse(cleaned) as T;
      } catch {
        // Fallback truncation recovery on the extracted JSON
        try {
          let attempt = cleaned.trim();
          attempt = attempt.replace(/,?\s*"[^"]*$/, "");
          const openBraces = (attempt.match(/\{/g) || []).length - (attempt.match(/\}/g) || []).length;
          const openBrackets = (attempt.match(/\[/g) || []).length - (attempt.match(/\]/g) || []).length;
          attempt += "}".repeat(Math.max(0, openBraces)) + "]".repeat(Math.max(0, openBrackets));
          return JSON.parse(attempt) as T;
        } catch {
          return null;
        }
      }
    }
    
    return null;
  }
}

// ─── System Prompts ───────────────────────────────────────────────────────────

const getSystemPrompt = (isExistingApp: boolean) => `You are an elite, Principal React Architect with over 20 years of industry experience. Generate a complete, working React frontend application. You possess deep wisdom in building scalable, production-grade architectures.

OUTPUT: Respond with a valid JSON object only — no markdown fences, no extra text.
{
  "assistantMessage": "<chat response or brief explanation of what you built/changed>",
  "title": "<short 2-4 word title>",
  "suggestions": [
    "Add a dark mode toggle",
    "Implement the settings page",
    "Add sample data to the table"
  ],
  "files": {
    ${isExistingApp ? `"/components/ExistingComponent.js": { 
      "replacements": [
        {
          "startLine": 10,
          "endLine": 15,
          "replacement": "<new code to insert>"
        }
      ]
    },
    "/components/BrandNewComponent.js": {
      "code": "<full file content - ONLY USE 'code' IF CREATING A COMPLETELY NEW FILE>"
    }` : `"/App.js": { "code": "<full file content>" }`}
  }
}

${isExistingApp ? `CRITICAL RULE FOR REPLACEMENTS:
The 'startLine' and 'endLine' MUST match the exact line numbers in the provided file where the code should be replaced. Replace the exact block of lines requested. Do NOT include line numbers in the 'replacement' code itself.` : ``}

RULES:
1. Use React functional components + hooks. NO TypeScript in generated files.
2. Build specifically for a Create-React-App template. Do NOT use Vite structures. Place all files (including App.js and index.js) directly in the root directory (/). Do NOT create a /src/ directory.
2. Use standard clean React architecture: put components in /components, pages in /pages, hooks in /hooks, and utils in /lib.
3. Entry point MUST be /App.js with a default export.
4. Use Tailwind CSS for all styling. Do NOT import "tailwindcss" or any CSS files directly. Tailwind is already loaded via CDN.
5. All imports must reference files you include or valid npm packages.
6. For placeholders and images, dynamically fetch descriptive images using the pollinations.ai API (e.g. https://image.pollinations.ai/prompt/a%20beautiful%20landscape).
7. NEVER use local image paths. For images use: https://image.pollinations.ai/prompt/{keyword}?width=800&height=600&nologo=true or https://placehold.co/600x400/png
8. **DUAL-MODE DATABASE**: You must create a data abstraction layer (e.g. /lib/db.js). This layer MUST check if process.env.REACT_APP_MONGODB_DATA_API_KEY exists. If it does, use the MongoDB Atlas Data API (via fetch) to persist data to the user's real database. If it does NOT exist, fall back to simulating data with localStorage. Do NOT attempt to use mongoose or direct TCP MongoDB connections, as this is a purely browser-based React app.
9. **DEPLOYMENT**: ALWAYS include a /README.md detailing exactly how to run the app, AND a dedicated section on how to deploy this app to Vercel, including instructions on where to configure the REACT_APP_MONGODB_DATA_API_URL, REACT_APP_MONGODB_DATA_API_KEY, and REACT_APP_MONGODB_DATA_API_CLUSTER environment variables in the Vercel dashboard.
10. If the user is just chatting or asking a question, you can omit the "files" field entirely and just respond with "assistantMessage" and "suggestions".
11. **SURGICAL REPLACEMENTS (CRITICAL)**: If the user is modifying an EXISTING app, you MUST be surgically precise: use the \`replacements\` array format to output ONLY the exact 1-2 lines of code that need to change! DO NOT output the full file \`code\` unless you are creating a BRAND NEW file. \`target\` MUST exactly match existing code character-for-character. If you rewrite massive files using the \`code\` format for a minor fix, YOU HAVE FAILED AND WILL CRASH THE APP. HOWEVER, if the user asks you to build a BRAND NEW app from scratch, you MUST output ALL necessary files using the \`code\` format.
12. **NO STUBS OR PLACEHOLDERS**: When using the \`code\` format, you MUST output the ENTIRE, fully-featured file contents. NEVER use placeholders like \`// ... existing code\`. If you output a stub using the \`code\` format, you will delete the user's existing code and break the app! Always prefer \`replacements\` for minor tweaks!
13. "suggestions" must be an array of exactly 3 specific, highly actionable feature suggestions that would elevate this app to a professional, top-tier level (e.g., "Add user profiles and secure authentication", "Add dark mode toggle and real-time notifications", "Implement advanced search and filtering").
14. **COMPLEX TASK SPLITTING (MVP FIRST)**: No matter how complex the user's request is, YOU MUST BUILD A SIMPLE MINIMUM VIABLE PRODUCT (MVP) FIRST! NEVER attempt to generate thousands of lines of code or complex architectures in a single go. Build the foundational core version 1 first. Then, in your \`suggestions\` array, provide exactly one suggestion to continue: "Proceed to Step 2: [Description of next advanced feature]". When the user clicks it, you will build Step 2, and so on. STRICTLY PREVENT LONG CODE GENERATION IN ONE GO!
15. **STUBBORN BUGS (REBUILD)**: If the user complains that an issue is STILL happening after you already tried to fix it, do NOT keep tweaking 1-2 lines. Instead, you MUST boldly suggest rebuilding the problematic component from scratch. Format the suggestion EXACTLY like this: "REBUILD: Rebuild [ComponentName] to fix the stubborn issue". The UI will render this as a prominent red button for the user to click.
14. **MOBILE-FIRST & RESPONSIVE**: You MUST design the application to be highly responsive. PRIORITIZE standard top-navigation (navbar) over sidebars unless strictly necessary. When implementing responsive sidebars or menus, NEVER conditionally unmount them using React state (e.g., \`{isOpen && <Sidebar/>}\`). Instead, ALWAYS render the component and use Tailwind media queries to control visibility and position (e.g., \`transform transition-transform md:translate-x-0 md:relative \${isOpen ? "translate-x-0" : "-translate-x-full"}\`). This prevents "state leakage" where closing a mobile menu accidentally hides the desktop menu when the browser is resized!
15. **LIGHT MODE DEFAULT**: Design the application in light mode by default (e.g., using white backgrounds and dark text) unless the user explicitly requests a dark mode theme.
16. **SENIOR UI/UX DESIGNER (CRITICAL)**: You are not just a developer; you are a SENIOR UI/UX DESIGNER. You MUST build premium, state-of-the-art, breathtaking designs. Use modern web design trends: trendy custom color palettes, glassmorphism, glowing neon accents, soft drop-shadows, and rounded corners. Use ample whitespace, perfect padding/margins, and structured grid/flexbox layouts. Use \`framer-motion\` heavily for micro-interactions, layout transitions, and hover effects. Ensure high contrast and accessibility. If your app looks like a basic bootstrap template, you have FAILED. Your designs must look like they were crafted by an award-winning design agency.
17. **CRITICAL ROUTING & IMPORTS**: If you use routing, you MUST import ALL components (e.g. \`BrowserRouter\`, \`Routes\`, \`Route\`, \`Link\`, \`NavLink\`, \`useNavigate\`) from \`react-router-dom\`. DO NOT use \`<Link>\` or \`<NavLink>\` without importing them first! WARNING: If you use \`<NavLink>\`, do NOT use the \`isActive\` property inside its children unless you use the render prop pattern \`{({ isActive }) => (...)}\`. If you use icons, MUST import them from \`lucide-react\`.
18. **CRITICAL EXPORTS & IMPORTS**: You MUST use \`export default\` for ALL your components, hooks, and utilities (e.g., \`export default function useTasks()\`). NEVER use named exports! When importing your own files, you MUST use default imports (e.g., \`import Sidebar from './components/Sidebar'\` or \`import useTasks from './hooks/useTasks'\`). If you see an error like \`(0, _useTasks.useTasks) is not a function\`, it means you incorrectly used a named import \`import { useTasks }\` for a default export! Fix it instantly by changing the import to \`import useTasks from\`.
19. **PRECISION TARGETING**: When asked to fix or add a feature to an EXISTING app, understand exactly what component handles that feature, and ONLY output a \`replacements\` patch for that specific file. DO NOT output the full file contents. The rest of the app is safely preserved in memory.
20. **ERROR CLASSIFIER**: If the user provides a compiler error, analyze it, determine the root cause (Syntax, Missing Import, Undefined Export, Hook Misuse), and provide a minimal surgical replacement to fix it.
`;

// ─── Contents builder ─────────────────────────────────────────────────────────

function buildFrontendContents(messages: Message[], fileData: FileData | null) {
  const trimmed = trimHistory(messages);

  return trimmed.map((msg, idx) => {
    const role = msg.role === "assistant" ? "model" : "user";

    if (msg.role === "user") {
      const parts: object[] = [];
      let text = msg.content;

      if (msg.imageUrl) {
        if (msg.imageUrl.startsWith("data:image/")) {
          const commaIndex = msg.imageUrl.indexOf(",");
          if (commaIndex !== -1) {
            const mimeType = msg.imageUrl.substring(5, msg.imageUrl.indexOf(";"));
            const base64Data = msg.imageUrl.substring(commaIndex + 1);
            parts.push({ inlineData: { data: base64Data, mimeType } });
            text = `[Image attached as design reference.]\n\n${text}`;
          }
        } else {
          text = `[Image URL for reference: ${msg.imageUrl}]\n\n${text}`;
        }
      }

      const isLast = idx === trimmed.length - 1;
      if (isLast && fileData) {
        let fileEntries = Object.entries(fileData.files ?? {});
        
        // TRUNCATION: Prioritize root and core architecture files
        fileEntries.sort(([pathA], [pathB]) => {
           const aImportant = pathA.includes("App") || pathA.includes("index") || pathA.includes("package.json");
           const bImportant = pathB.includes("App") || pathB.includes("index") || pathB.includes("package.json");
           if (aImportant && !bImportant) return -1;
           if (!aImportant && bImportant) return 1;
           return 0;
        });

        let fileSummary = "";
        let charCount = 0;
        const MAX_CHARS = 25000; // Capped at ~6000 tokens

        for (const [path, fileObj] of fileEntries) {
          const code = (fileObj as any).code || "";
          const numberedCode = typeof code === "string" ? code.split("\n").map((line: string, i: number) => `${i + 1} | ${line}`).join("\n") : "";
          const entry = `### ${path}\n\`\`\`\n${numberedCode}\n\`\`\`\n\n`;
          if (charCount + entry.length > MAX_CHARS) {
             fileSummary += `\n\n[System: Additional older files omitted from context to save tokens. Proceed with available files.]`;
             break;
          }
          fileSummary += entry;
          charCount += entry.length;
        }

        text += `\n\nCurrent project files:\n${fileSummary}\nDependencies: ${JSON.stringify(fileData.dependencies ?? {})}`;
      }

      parts.push({ text });
      return { role, parts };
    }

    return { role, parts: [{ text: msg.content }] };
  });
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function generateWorkspaceTask(
  { workspaceId, userId, messages, fileData, retryCount }: { workspaceId: string | null; userId: string; messages: Message[]; fileData: FileData | null; retryCount?: number },
  enqueue: (type: string, payload: unknown) => void
) {
  await connectDB();

  const user = await User.findById(userId).select("_id credits");
  if (!user) throw new Error("User not found");
    
  const cost = calculateGenerationCost(messages);
  
  if (user.credits < cost) {
    throw new Error(`Insufficient credits. This complex task requires ${cost} credits, but you only have ${user.credits}.`);
  }

  let projectSpec: any = null;
  try {

        // ── GENERATION PASS ──────────────────────────────────────────────────

        enqueue("status", { message: "Thinking…" });

        const initialContents = buildFrontendContents(messages, fileData);
        let currentContents = [...initialContents];
        
        
        let assistantMessage = "";
        let aiTitle: string | undefined = undefined;
        let suggestions: string[] = [];
        let files: Record<string, { code?: string; replacements?: Array<{ target?: string; replacement: string; startLine?: number; endLine?: number }> }> | undefined = undefined;
        let finalDependencies: Record<string, string> = { ...(fileData?.dependencies ?? {}) };
        
        const isExistingApp = !!(fileData?.files && Object.keys(fileData.files).length > 0);
        const lastUserMessage = messages[messages.length - 1];

        if (isExistingApp) {
          // --- EXISTING APP: FAST PATCH PIPELINE ---
          let rawJson = "";
          let isComplete = false;
          let loops = 0;

          while (!isComplete && loops < 15) {
            loops++;
            const targetModel = (retryCount ?? 0) >= 3 ? PRO_MODEL : DEFAULT_MODEL;
            if ((retryCount ?? 0) >= 3 && loops === 1) {
              enqueue("status", { message: "Escalating to Deep Reasoning Mode..." });
            }
            
            let chunk = "";
            try {
              chunk = await runGeminiPass(
                targetModel,
                currentContents,
                getSystemPrompt(isExistingApp),
                (label) => enqueue("status", { message: loops > 1 ? "Writing massive codebase..." : label })
              );
            } catch (err: any) {
              console.error("[runGeminiPass error]:", err);
              enqueue("status", { message: "AI API error. Attempting to recover generated code..." });
              break;
            }

            if (!chunk || chunk.trim().length === 0) {
              console.error("[runGeminiPass error]: Empty chunk received.");
              break;
            }
            
            let newChunk = chunk;
            if (loops > 1) {
              newChunk = newChunk.trimStart();
              if (newChunk.startsWith("```json")) newChunk = newChunk.replace(/^```json\s*/i, "");
              else if (newChunk.startsWith("```")) newChunk = newChunk.replace(/^```[a-z]*\s*/i, "");
            }
            rawJson += newChunk;
            
            let checkStr = rawJson.trim();
            if (checkStr.startsWith("```json")) checkStr = checkStr.replace(/^```json\s*/i, "");
            else if (checkStr.startsWith("```")) checkStr = checkStr.replace(/^```[a-z]*\s*/i, "");
            if (checkStr.endsWith("```")) checkStr = checkStr.replace(/```$/, "").trim();
            
            try {
              JSON.parse(checkStr);
              isComplete = true;
              rawJson = checkStr;
            } catch (e) {
              isComplete = false;
            }

            if (!isComplete) {
              enqueue("status", { message: "Writing massive codebase..." });
              currentContents.push({ role: "model", parts: [{ text: chunk }] });
              currentContents.push({ role: "user", parts: [{ text: "Continue exactly where you left off." }] });
            }
          }

          const parsed = safeParseJSON<{
            assistantMessage: string;
            title?: string;
            suggestions?: string[];
            files?: Record<string, { code?: string; replacements?: Array<{ target?: string; replacement: string; startLine?: number; endLine?: number }> }>;
          }>(rawJson);

          if (!parsed) {
            enqueue("error", { message: "Generation failed. Please try again." });
            controller.close();
            return;
          }

          assistantMessage = parsed.assistantMessage;
          aiTitle = parsed.title;
          suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions : (typeof parsed.suggestions === "string" ? [parsed.suggestions] : []);
          files = parsed.files;
          
        } else {
          // --- NEW APP: MULTI-AGENT SEQUENTIAL PIPELINE ---
          
          // Agent 1: Product Analyst
          enqueue("status", { message: "Product Analyst: Extracting requirements..." });
          const analystPrompt = `You are a Senior Product Analyst. Analyze this prompt for a web application:
${lastUserMessage.content}

If the request is highly complex, break it down. Plan a solid "First Version" (MVP) that can be built immediately. Then, list the remaining complex features as "futureTasks" that can be built later.
Output strict JSON ONLY: { "requirements": "<Summary of what will be built NOW in the MVP>", "pages": [...], "features": [...], "futureTasks": ["<List of 3-5 remaining complex features to build next>"] }`;
          
          let analystText = "";
          try {
            const analystRes = await generateContent({ 
              model: DEFAULT_MODEL, 
              contents: [{ role: "user", parts: [{ text: analystPrompt }] }],
              config: { responseMimeType: "application/json" }
            });
            analystText = analystRes?.text || "";
          } catch (err) {
    console.error("[generateWorkspaceTask] error:", err);
    enqueue("error", {
      message: err instanceof Error ? err.message : "Something went wrong. Please try again.",
    });
    throw err;
  }
}
