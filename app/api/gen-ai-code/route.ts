import { getSession } from "@/lib/auth";
import { NextRequest } from "next/server";
import { connectDB } from "@/lib/mongodb";
import User from "@/lib/models/User";
import Workspace from "@/lib/models/Workspace";
import { generateContentStream, DEFAULT_MODEL, PRO_MODEL } from "@/lib/gemini";
import { calculateGenerationCost } from "@/lib/credit-calculator";
import { extractDependencies, findMissingFiles, autoFixAbsoluteImports, autoStubMissingFiles } from "@/lib/dependencies";
import { BASE_DEPENDENCIES, REACT_BOILERPLATE } from "@/lib/constants";
import type { Message, FileData } from "@/types/workspace";
import mongoose from "mongoose";

// ─── SSE helper ───────────────────────────────────────────────────────────────

function sseEvent(type: string, payload: unknown): string {
  return `data: ${JSON.stringify({ type, ...(payload as object) })}\n\n`;
}

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
      responseMimeType: "text/plain",
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
          "target": "<exact string of existing code to replace (must match exactly)>",
          "replacement": "<new 1-2 lines of code to insert>"
        }
      ]
    },
    "/components/BrandNewComponent.js": {
      "code": "<full file content - ONLY USE 'code' IF CREATING A COMPLETELY NEW FILE>"
    }` : `"/App.js": { "code": "<full file content>" }`}
  }
}

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
18. **CRITICAL EXPORTS**: You MUST use \`export default function\` for ALL your components. When importing local components, you MUST use default imports (e.g. \`import Sidebar from './components/Sidebar'\`). NEVER use named exports/imports for your own components!
19. **PRECISION TARGETING**: When asked to fix or add a feature to an EXISTING app, understand exactly what component handles that feature, and ONLY output a \`replacements\` patch for that specific file. DO NOT output the full file contents. The rest of the app is safely preserved in memory.
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

        for (const [path, { code }] of fileEntries) {
          const entry = `### ${path}\n\`\`\`\n${code}\n\`\`\`\n\n`;
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

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return Response.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { workspaceId, userId, messages, fileData } = body as {
    workspaceId: string | null;
    userId: string;
    messages: Message[];
    fileData: FileData | null;
  };

  if (!messages?.length) {
    return Response.json({ message: "No messages provided" }, { status: 400 });
  }

  if (userId !== session.userId) {
    return Response.json({ message: "Unauthorized" }, { status: 401 });
  }

  await connectDB();

  const user = await User.findById(userId).select("_id credits");
  if (!user)
    return Response.json({ message: "User not found" }, { status: 404 });
    
  const cost = calculateGenerationCost(messages);
  
  if (user.credits < cost) {
    return Response.json({ message: `Insufficient credits. This complex task requires ${cost} credits, but you only have ${user.credits}.` }, { status: 402 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (chunk: string) =>
        controller.enqueue(encoder.encode(chunk));

      try {
        // ── GENERATION PASS ──────────────────────────────────────────────────

        enqueue(sseEvent("status", { message: "Thinking…" }));

        const initialContents = buildFrontendContents(messages, fileData);
        let currentContents = [...initialContents];
        
        let rawJson = "";
        let isComplete = false;
        let loops = 0;

        while (!isComplete && loops < 15) {
          loops++;
          
          const isExistingApp = !!(fileData?.files && Object.keys(fileData.files).length > 0);
          const chunk = await runGeminiPass(
            DEFAULT_MODEL,
            currentContents,
            getSystemPrompt(isExistingApp),
            (label) => enqueue(sseEvent("status", { message: loops > 1 ? `Continuing generation (Part ${loops})...` : label }))
          );
          
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
            isComplete = true; // If it parses, it's a complete JSON object!
            rawJson = checkStr; // Save the cleaned string for the final parse
          } catch (e) {
            isComplete = false; // Failed to parse, meaning it's highly likely truncated
          }

          if (!isComplete) {
            enqueue(sseEvent("status", { message: "App is massive! Seamlessly extending context window..." }));
            currentContents.push({ role: "model", parts: [{ text: chunk }] });
            currentContents.push({ 
              role: "user", 
              parts: [{ text: "Your previous response was cut off by the output token limit. Please continue generating the exact JSON string from the precise character where you left off. Do not include any explanations, markdown fences, or starting brackets. Just append directly to the previous string." }] 
            });
          }
        }

        const parsed = safeParseJSON<{
          assistantMessage: string;
          title?: string;
          suggestions?: string[];
          files?: Record<string, { 
            code?: string;
            replacements?: Array<{ target: string; replacement: string }>;
          }>;
        }>(rawJson);

        if (!parsed) {
          enqueue(sseEvent("error", { message: "Generation failed due to output length limits. Please ask for a simpler app." }));
          controller.close();
          return;
        }

        const { assistantMessage, title: aiTitle, suggestions, files } = parsed;

        // ── Merge existing files with new files ────────────────────────────────

        // Automatically upgrade older workspaces by ensuring Vite core files are present
        const baseWorkspace: Record<string, { code: string }> = { 
          ...(fileData?.files ?? {}) 
        };
        
        // Clean up Vite /src/ directories and force them back to root for CRA
        for (const key of Object.keys(baseWorkspace)) {
          if (key.startsWith("/src/")) {
            const rootKey = key.replace("/src", "");
            // Prioritize existing root files, otherwise move the src file to root
            if (!baseWorkspace[rootKey]) {
              baseWorkspace[rootKey] = baseWorkspace[key];
            }
            delete baseWorkspace[key];
          }
        }
        
        // CRITICAL: Sandpack's vite-react template crashes if we override /package.json
        // Delete any legacy package.json so Sandpack relies on customSetup.dependencies safely
        delete baseWorkspace["/package.json"];
        
        // Force Vite configs
        // Force CRA configs
        if (REACT_BOILERPLATE["/index.js"]) {
          if (!baseWorkspace["/index.js"]) {
            baseWorkspace["/index.js"] = REACT_BOILERPLATE["/index.js"];
          }
          delete baseWorkspace["/src/index.jsx"];
        }
        if (REACT_BOILERPLATE["/styles.css"]) {
          if (!baseWorkspace["/styles.css"]) {
            baseWorkspace["/styles.css"] = REACT_BOILERPLATE["/styles.css"];
          }
          delete baseWorkspace["/src/styles.css"];
        }
        if (REACT_BOILERPLATE["/public/index.html"]) {
          baseWorkspace["/public/index.html"] = REACT_BOILERPLATE["/public/index.html"];
          delete baseWorkspace["/index.html"];
        }

        const normalizedFiles: Record<string, { code: string }> = { ...baseWorkspace };
        
        if (files) {
          for (const [key, value] of Object.entries(files)) {
            let path = key;
            if (!path.startsWith("/")) path = "/" + path;
            
            // Force files out of /src/ so they align with Sandpack CRA root structure
            if (path.startsWith("/src/")) {
              path = path.replace("/src", "");
            }
            
            if (path === "/App.jsx") path = "/App.js";
            
            // Clean markdown fences if code is provided
            let rawCode = value.code;
            if (typeof rawCode === "string") {
              rawCode = rawCode.replace(/^```[a-z]*\n/i, "").replace(/\n```$/i, "");
            }

            // If replacements are provided instead of full code, apply them surgically
            if (!rawCode && value.replacements && Array.isArray(value.replacements)) {
              let existingCode = baseWorkspace[path]?.code || "";
              if (existingCode) {
                value.replacements.forEach(rep => {
                  if (rep.target && typeof rep.replacement === "string") {
                    existingCode = existingCode.replace(rep.target, rep.replacement);
                  }
                });
                rawCode = existingCode;
              } else {
                rawCode = ""; // Cannot apply replacements to non-existent files
              }
            }

            // AUTO-HEALER: Prevent "ReferenceError: X is not defined" for React Router
            rawCode = rawCode ?? "";
            const routerTokens = ["BrowserRouter", "Routes", "Route", "Link", "useNavigate", "useParams", "useLocation", "Navigate"];
            routerTokens.forEach(token => {
              const usesToken = new RegExp(`\\b${token}\\b`).test(rawCode as string);
              const importsToken = new RegExp(`import\\s+.*\\b${token}\\b.*\\s+from\\s+['"]react-router-dom['"]`).test(rawCode as string);
              if (usesToken && !importsToken) {
                rawCode = `import { ${token} } from 'react-router-dom';\n` + rawCode;
              }
            });

            // AUTO-HEALER: Fix Lucide Icon Hallucinations & Remap Non-existent Icons
            const iconRemap: Record<string, string> = {
              "Chat": "MessageCircle",
              "Comment": "MessageSquare",
              "ThumbUp": "ThumbsUp",
              "ThumbDown": "ThumbsDown",
              "DotsVertical": "MoreVertical",
              "DotsHorizontal": "MoreHorizontal",
              "Cross": "X",
              "Close": "X",
              "Error": "AlertCircle",
              "Warning": "AlertTriangle",
              "Success": "CheckCircle2",
              "Add": "Plus",
              "Remove": "Minus",
              "Delete": "Trash2",
              "Edit": "Edit2",
              // Social & UI common hallucinations
              "Explore": "Compass",
              "Notifications": "Bell",
              "Notification": "Bell",
              "Messages": "Mail",
              "Message": "MessageSquare",
              "Bookmarks": "Bookmark",
              "Profile": "User",
              "Retweet": "Repeat",
              "Like": "Heart",
              "Reply": "MessageCircle",
              "Gif": "FileImage",
              "Poll": "BarChart2",
              "Emoji": "Smile",
              "Schedule": "Calendar",
              "Location": "MapPin",
              "More": "MoreHorizontal",
              "Analytics": "BarChart2",
              "Settings": "Settings"
            };
            
            // Fix completely missing imports for commonly used icons
            const commonIcons = ["Plus", "Minus", "Trash", "Trash2", "Edit", "Edit2", "Settings", "User", "Check", "X", "Search", "Menu", "Home", "ChevronLeft", "ChevronRight", "ChevronUp", "ChevronDown", "ArrowLeft", "ArrowRight", "LogOut", "Bell", "Heart", "Star", "Camera", "Image", "Upload", "Download", "Loader2", "Eye", "EyeOff", "MoreVertical", "MoreHorizontal", "Info", "AlertCircle", "AlertTriangle", "CheckCircle2", "Play", "Pause", "SkipForward", "SkipBack", "Volume2", "VolumeX", "Maximize", "Minimize", "Maximize2", "Minimize2", "RefreshCw", "Share2", "Link", "Copy", "Calendar", "Clock", "MapPin", "MessageCircle", "MessageSquare", "Send", "Paperclip", "File", "Folder", "ShoppingCart", "CreditCard", "Lock", "Unlock", "Shield", "Wifi", "WifiOff", "Battery", "BatteryCharging", "Smartphone", "Monitor", "Laptop", "Tv", "Headphones", "Mic", "MicOff", "Video", "VideoOff"];
            commonIcons.forEach(icon => {
              const usesIcon = new RegExp(`<${icon}\\b`).test(rawCode as string);
              // Check if the identifier is already imported from anywhere, or declared locally
              const isDeclared = new RegExp(`import\\s+.*\\b${icon}\\b.*\\s+from`).test(rawCode as string) || 
                                 new RegExp(`(?:const|let|var|function|class)\\s+${icon}\\b`).test(rawCode as string);
              if (usesIcon && !isDeclared) {
                rawCode = `import { ${icon} } from 'lucide-react';\n` + rawCode;
              }
            });
            
            rawCode = rawCode.replace(/import\s+{([^}]+)}\s+from\s+['"]lucide-react['"]/g, (match, p1) => {
              const fixedImports = p1.split(',').map((i: string) => {
                const trimmed = i.trim();
                if (!trimmed) return "";
                
                let baseName = trimmed.replace(/Icon$/, "");
                let aliasName = trimmed;
                
                // If it already has an alias " as ", extract the base
                if (trimmed.includes(" as ")) {
                  const parts = trimmed.split(" as ");
                  baseName = parts[0].trim();
                  aliasName = parts[1].trim();
                }
                
                // Remap hallucinated base name if it exists in our map
                if (iconRemap[baseName]) {
                  baseName = iconRemap[baseName];
                }
                
                // Always alias it back to what the AI's JSX expects
                return `${baseName} as ${aliasName}`;
              }).filter(Boolean).join(', ');
              return `import { ${fixedImports} } from 'lucide-react'`;
            });

            // AUTO-HEALER: Fix missing export default
            if (!rawCode.includes("export default")) {
              const funcMatch = rawCode.match(/function\s+([A-Z][a-zA-Z0-9_]*)\s*\(/);
              if (funcMatch) {
                rawCode += `\nexport default ${funcMatch[1]};\n`;
              } else {
                const arrowMatch = rawCode.match(/const\s+([A-Z][a-zA-Z0-9_]*)\s*=\s*(?:\([^)]*\)|[a-zA-Z0-9_]+)\s*=>/);
                if (arrowMatch) {
                  rawCode += `\nexport default ${arrowMatch[1]};\n`;
                }
              }
            }

            normalizedFiles[path] = { ...value, code: rawCode };
          }
        }
        
        // Ensure robustness with AST extraction and auto stubbing
        autoFixAbsoluteImports(normalizedFiles);
        const missing = findMissingFiles(normalizedFiles);
        if (missing.length > 0) {
          autoStubMissingFiles(normalizedFiles, missing);
        }

        enqueue(sseEvent("status", { message: "Extracting packages…" }));
        const extracted = extractDependencies(normalizedFiles);
        const finalDependencies: Record<string, string> = { ...(fileData?.dependencies ?? {}) };
        extracted.forEach(pkg => {
          if (!finalDependencies[pkg] && !BASE_DEPENDENCIES[pkg]) {
            finalDependencies[pkg] = "latest";
          }
        });

        const newFileData: FileData = {
          files: normalizedFiles,
          dependencies: finalDependencies,
          title: aiTitle ?? fileData?.title,
          suggestions,
          envVars: fileData?.envVars,
        };

        // ── Upsert workspace + deduct credit ──────────────────────────────────

        enqueue(sseEvent("status", { message: "Saving…" }));

        const lastUserMessage = messages[messages.length - 1];
        const updatedMessages: Message[] = [
          ...messages,
          { role: "assistant", content: assistantMessage },
        ];

        const userObjectId = new mongoose.Types.ObjectId(userId);

        let workspace;
        if (workspaceId) {
          workspace = await Workspace.findOneAndUpdate(
            { _id: workspaceId, userId: userObjectId },
            { messages: updatedMessages, fileData: newFileData },
            { new: true }
          );
        } else {
          // Generate a unique, readable subdomain (e.g. app-xxxxx)
          const subdomain = "app-" + Math.random().toString(36).substring(2, 9);
          
          workspace = await Workspace.create({
            userId: userObjectId,
            title: aiTitle ?? lastUserMessage.content.slice(0, 80),
            subdomain,
            messages: updatedMessages,
            fileData: newFileData,
          });
        }

        await User.findByIdAndUpdate(userId, {
          $inc: { credits: -cost },
        });

        const updatedUser = await User.findById(userId).select("credits");

        enqueue(
          sseEvent("done", {
            workspaceId: workspace!._id.toString(),
            subdomain: workspace!.subdomain,
            assistantMessage,
            fileData: newFileData,
            creditsRemaining:
              updatedUser?.credits ?? user.credits - cost,
          })
        );
      } catch (err) {
        console.error("[gen-ai-code] stream error:", err);
        enqueue(
          sseEvent("error", {
            message: err instanceof Error ? err.message : "Something went wrong. Please try again.",
          })
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

export const runtime = "nodejs";
export const maxDuration = 300;
