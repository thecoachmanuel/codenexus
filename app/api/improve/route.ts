import { getSession } from "@/lib/auth";
import { NextRequest } from "next/server";
import { Agent, createTool } from "@cline/sdk";
import { z } from "zod";
import { extractDependencies, findMissingFiles, autoFixAbsoluteImports, autoStubMissingFiles } from "@/lib/dependencies";
import { BASE_DEPENDENCIES } from "@/lib/constants";
import { connectDB } from "@/lib/mongodb";
import User from "@/lib/models/User";
import Workspace from "@/lib/models/Workspace";
import { calculateImprovementCost } from "@/lib/credit-calculator";
import { PRO_MODEL, getApiKey, rotateApiKey, getApiKeysCount } from "@/lib/gemini";
import type { FileData } from "@/types/workspace";
import mongoose from "mongoose";

// ─── SSE helper ───────────────────────────────────────────────────────────────

function sseEvent(type: string, payload: object): string {
  return `data: ${JSON.stringify({ type, ...payload })}\n\n`;
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session)
    return Response.json({ message: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { userId, workspaceId, userRequest, fileData } = body as {
    userId: string;
    workspaceId: string;
    userRequest: string;
    fileData: FileData;
  };

  // Verify the userId matches the session
  if (userId !== session.userId) {
    return Response.json({ message: "Unauthorized" }, { status: 401 });
  }

  await connectDB();

  const user = await User.findById(userId).select("_id credits plan");
  if (!user)
    return Response.json({ message: "User not found" }, { status: 404 });

  // Pro-only gate
  if (user.plan !== "pro")
    return Response.json({ message: "Upgrade required" }, { status: 403 });

  const cost = calculateImprovementCost(fileData, userRequest);

  if (user.credits < cost)
    return Response.json({ message: `Insufficient credits. This complex task requires ${cost} credits, but you only have ${user.credits}.` }, { status: 402 });

  // ── Build the agent ────────────────────────────────────────────────────────

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (chunk: string) =>
        controller.enqueue(encoder.encode(chunk));

      const patchedFiles: Record<string, { code: string }> = {
        ...(fileData.files ?? {}),
      };
      let finalSummary = "";
      let finalSuggestions = fileData.suggestions ?? [];

      const listFilesTool = createTool({
        name: "list_files",
        description: "List all files currently in the React sandbox.",
        inputSchema: z.object({}),
        async execute() {
          return JSON.stringify(Object.keys(patchedFiles), null, 2);
        },
      });

      const readFileTool = createTool({
        name: "read_file",
        description: "Read the contents of a specific file.",
        inputSchema: z.object({
          path: z.string().describe("File path, e.g. /App.js"),
        }),
        async execute({ path }) {
          let normalizedPath = path;
          if (!normalizedPath.startsWith("/")) normalizedPath = "/" + normalizedPath;
          const file = patchedFiles[normalizedPath];
          if (!file) return `Error: File ${normalizedPath} not found.`;
          return file.code;
        },
      });

      const updateFileTool = createTool({
        name: "update_file",
        description:
          "Update or rewrite a FRONTEND file in the React sandbox. Call once per file you need to change.",
        inputSchema: z.object({
          path: z
            .string()
            .describe("File path exactly as it appears, e.g. /App.js"),
          code: z.string().describe("Complete new contents of the file"),
          reason: z
            .string()
            .describe("One sentence explaining what you changed and why"),
        }),
        async execute({ path, code, reason }) {
          let normalizedPath = path;
          if (!normalizedPath.startsWith("/")) normalizedPath = "/" + normalizedPath;
          if (normalizedPath.startsWith("/src/")) {
            normalizedPath = normalizedPath.replace("/src/", "/");
          }
          if (normalizedPath === "/App.jsx" || normalizedPath === "/App.tsx") {
            normalizedPath = "/App.js";
          }
          
          let rawCode = code;
          if (typeof rawCode === "string") {
            rawCode = rawCode.replace(/^```[a-z]*\n/i, "").replace(/\n```$/i, "");
          }

          // AUTO-HEALER: Prevent "ReferenceError: X is not defined" for React Router
          const routerTokens = ["BrowserRouter", "Routes", "Route", "Link", "useNavigate", "useParams", "useLocation", "Navigate", "NavLink"];
          routerTokens.forEach(token => {
            const usesToken = new RegExp(`\\b${token}\\b`).test(rawCode);
            const importsToken = new RegExp(`import\\s+.*\\b${token}\\b.*\\s+from\\s+['"]react-router-dom['"]`).test(rawCode);
            if (usesToken && !importsToken) {
              rawCode = `import { ${token} } from 'react-router-dom';\n` + rawCode;
            }
          });

          // AUTO-HEALER: Fix Lucide Icon Hallucinations & Remap Non-existent Icons
          const iconRemap: Record<string, string> = {
            "Chat": "MessageCircle", "Comment": "MessageSquare", "ThumbUp": "ThumbsUp", "ThumbDown": "ThumbsDown",
            "DotsVertical": "MoreVertical", "DotsHorizontal": "MoreHorizontal", "Cross": "X", "Close": "X",
            "Error": "AlertCircle", "Warning": "AlertTriangle", "Success": "CheckCircle2", "Add": "Plus",
            "Remove": "Minus", "Delete": "Trash2", "Edit": "Edit2", "Explore": "Compass", "Notifications": "Bell",
            "Notification": "Bell", "Messages": "Mail", "Message": "MessageSquare", "Bookmarks": "Bookmark",
            "Profile": "User", "Retweet": "Repeat", "Like": "Heart", "Reply": "MessageCircle", "Gif": "FileImage",
            "Poll": "BarChart2", "Emoji": "Smile", "Schedule": "Calendar", "Location": "MapPin", "More": "MoreHorizontal",
            "Analytics": "BarChart2", "Settings": "Settings"
          };
          
          rawCode = rawCode.replace(/import\s+{([^}]+)}\s+from\s+['"]lucide-react['"]/g, (match, p1) => {
            const fixedImports = p1.split(',').map((i: string) => {
              const trimmed = i.trim();
              if (!trimmed) return "";
              let baseName = trimmed.replace(/Icon$/, "");
              let aliasName = trimmed;
              if (trimmed.includes(" as ")) {
                const parts = trimmed.split(" as ");
                baseName = parts[0].trim();
                aliasName = parts[1].trim();
              }
              if (iconRemap[baseName]) baseName = iconRemap[baseName];
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

          patchedFiles[normalizedPath] = { code: rawCode };
          enqueue(sseEvent("file_patch", { path: normalizedPath, code: rawCode, reason }));
          return `Updated frontend ${normalizedPath}: ${reason}`;
        },
      });
      const patchFileTool = createTool({
        name: "patch_file",
        description:
          "Surgically update an existing file by replacing a specific string of code. Use this for minor 1-2 line fixes to avoid rewriting massive files.",
        inputSchema: z.object({
          path: z.string().describe("File path, e.g. /App.js"),
          target: z.string().describe("Exact string of existing code to replace. Must match exactly, including whitespace!"),
          replacement: z.string().describe("The new code to insert in place of the target."),
          reason: z.string().describe("Why you are making this patch"),
        }),
        async execute({ path, target, replacement, reason }) {
          let normalizedPath = path;
          if (!normalizedPath.startsWith("/")) normalizedPath = "/" + normalizedPath;
          if (normalizedPath === "/App.jsx" || normalizedPath === "/App.tsx") normalizedPath = "/App.js";

          const existingCode = patchedFiles[normalizedPath]?.code || baseWorkspace[normalizedPath]?.code;
          if (!existingCode) {
            throw new Error(`Cannot patch ${normalizedPath} because it does not exist.`);
          }
          if (!existingCode.includes(target)) {
            throw new Error(`Patch failed! The exact target string was not found in ${normalizedPath}. Please ensure whitespace matches exactly, or use update_file instead.`);
          }

          const rawCode = existingCode.replace(target, replacement);
          patchedFiles[normalizedPath] = { code: rawCode };
          enqueue(sseEvent("file_patch", { path: normalizedPath, code: rawCode, reason }));
          return `Successfully patched ${normalizedPath}: ${reason}`;
        },
      });



      const doneImprovingTool = createTool({
        name: "done_improving",
        description:
          "Call this when you have finished making all improvements.",
        inputSchema: z.object({
          summary: z
            .string()
            .describe(
              "A short friendly summary of all the improvements you made (1-3 sentences)"
            ),
          newSuggestions: z.array(z.string()).optional(),
        }),
        async execute({ summary, newSuggestions }) {
          autoFixAbsoluteImports(patchedFiles);
          const missing = findMissingFiles(patchedFiles);
          if (missing.length > 0) {
            const missingStrs = missing.map(m => `'${m.importPath}' (imported in ${m.importedIn})`);
            throw new Error(`Improvement rejected! You imported the following files but forgot to create them:\n${missingStrs.join('\n')}\n\nYou MUST use update_file to create these missing files before you are allowed to call done_improving.`);
          }

          finalSummary = summary;
          if (newSuggestions && newSuggestions.length > 0) {
            finalSuggestions = newSuggestions;
          }
          return "Done.";
        },
      });

      try {
        let result: any;
        const keysCount = getApiKeysCount();
        const maxAttempts = keysCount * 2;
        
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          let currentModelId = PRO_MODEL;

          const agent = new Agent({
            providerId: "gemini",
            modelId: currentModelId,
            apiKey: getApiKey(),
            maxIterations: 30,
            systemPrompt: `You are an expert full-stack React developer improving an app.

WORKFLOW:
1. Understand what the user wants improved.
2. Use \`list_files\` to see the directory structure.
3. Use \`read_file\` to read ONLY the specific files you need to understand or modify. Act efficiently; do not waste iterations reading unnecessary files.
4. Call \`update_file\` to rewrite the target files with your improvements.
5. Once all target files are updated, call \`done_improving\` with a short summary.

CRITICAL RULES:
1. **RETAIN EVERYTHING**: When using \`update_file\`, your output MUST contain the ENTIRE modified file contents! NEVER delete existing functionality or styling unless explicitly asked. If you output a stub, the app will break!
1b. **SURGICAL PATCHING**: ALWAYS prefer using the \`patch_file\` tool for minor bug fixes or 1-2 line changes. \`update_file\` should only be used when writing brand new files or rewriting major sections.
2. **ARCHITECTURE**: Build specifically for a Create-React-App template. Place all files directly in the root directory (/). Do NOT use Vite structures or create a /src/ directory. Entry point MUST be \`/App.js\` with a default export. NO TypeScript.
3. **RICH AESTHETICS, TYPOGRAPHY & UI/UX**: You MUST build premium, state-of-the-art designs. Use modern web design trends: trendy custom color palettes (e.g., sleek dark modes, vibrant pastels, or neon accents), glassmorphism, soft drop-shadows, and rounded corners. **TYPOGRAPHY**: Keep body text at standard professional sizes (e.g., \`text-sm\` or \`text-base\`); do not use excessively large fonts for normal text. Use tight tracking (\`tracking-tight\`) on large headers. NEVER use generic flat colors (like \`bg-blue-500\`); use rich gradients and tailored HSL palettes to ensure a rich UX. If your app looks basic, you have FAILED.
4. **DYNAMIC ANIMATIONS**: Use \`framer-motion\` to add micro-interactions, page transitions, and hover effects. An interface that feels alive encourages interaction.
5. **COMPLETENESS**: DO NOT stub out files or use placeholders like \`// implement later\`. Write fully-featured, production-ready code. Always write complete file contents.
6. **STYLING**: Use Tailwind CSS for all styling. Rely on utility classes exclusively. Always include generous padding, rounded corners, subtle borders, and harmonious color palettes.
7. **DATABASE**: If modifying data fetching, use a data abstraction layer (e.g. \`/lib/db.js\`). Check if \`process.env.REACT_APP_MONGODB_DATA_API_KEY\` exists to use Atlas, else simulate with \`localStorage\`.
8. **DEPLOYMENT**: Keep \`/README.md\` updated with instructions for running and deploying to Vercel.
9. **IMAGES**: NEVER use local image paths. ALWAYS use: https://image.pollinations.ai/prompt/{keyword}?width=800&height=600&nologo=true or https://placehold.co/600x400/png
10. **MOBILE-FIRST & RESPONSIVE**: You MUST design the application to be highly responsive. PRIORITIZE standard top-navigation (navbar) over sidebars unless strictly necessary. When implementing responsive sidebars or menus, NEVER conditionally unmount them using React state (e.g., \`{isOpen && <Sidebar/>}\`). Instead, ALWAYS render the component and use Tailwind media queries to control visibility and position (e.g., \`transform transition-transform md:translate-x-0 md:relative \${isOpen ? "translate-x-0" : "-translate-x-full"}\`). This prevents "state leakage" where closing a mobile menu accidentally hides the desktop menu when the browser is resized!
11. **CRITICAL ROUTING & IMPORTS**: If you use routing, you MUST import ALL components (e.g. \`BrowserRouter\`, \`Routes\`, \`Route\`, \`Link\`, \`NavLink\`, \`useNavigate\`) from \`react-router-dom\`. DO NOT use \`<Link>\` or \`<NavLink>\` without importing them first! WARNING: If you use \`<NavLink>\`, do NOT use the \`isActive\` property inside its children unless you use the render prop pattern \`{({ isActive }) => (...)}\`. If you use icons, MUST import them from \`lucide-react\`.
13. **COMPLEX TASK SPLITTING**: If the user requests a massive, complex feature that requires generating large amounts of code across multiple files, DO NOT try to build it all in one loop! You will crash or run out of iterations. Instead, automatically split the work into smaller sequential steps. Build ONLY Step 1 right now. When Step 1 is complete, call \`done_improving\` and use the \`newSuggestions\` parameter to output: "Proceed to Step 2: [Description of next step]". The user will click it to trigger a fresh Agent loop for Step 2. Continue this until the full feature is built.
14. **NO ORPHANED CSS**: Our boilerplate imports \`./styles.css\` globally. DO NOT import \`./index.css\` or \`./App.css\`.

CRITICAL REMINDER: AESTHETICS ARE VERY IMPORTANT. If your web app looks simple and basic then you have FAILED! Do not just output standard HTML elements.`,
            tools: [listFilesTool, readFileTool, updateFileTool, patchFileTool, doneImprovingTool],
            toolPolicies: {
              list_files: { autoApprove: true },
              read_file: { autoApprove: true },
              update_file: { autoApprove: true },
              patch_file: { autoApprove: true },
              done_improving: { autoApprove: true },
            },
            hooks: {
              onEvent: (event) => {
                if (event.type === "assistant-text-delta" && event.text) {
                  enqueue(sseEvent("thinking", { text: event.text }));
                }
                if (event.type === "tool-started") {
                  const name = event.toolCall?.toolName;
                  if (name === "update_file") {
                    const path =
                      (event.toolCall?.input as { path?: string })?.path ?? "a file";
                    enqueue(
                      sseEvent("thinking", { text: `\n\nUpdating \`${path}\`…` })
                    );
                  } else if (name === "done_improving") {
                    enqueue(
                      sseEvent("thinking", { text: "\n\nFinalizing improvements…" })
                    );
                  }
                }
              },
            },
          });

          try {
            if (attempt === 0) enqueue(sseEvent("status", { message: "Agent starting…" }));
            
            result = await agent.run(userRequest);
            
            if (result.status === "failed") {
              if (attempt < maxAttempts - 1) {
                console.warn("[improve] Agent failed, falling back to next model/key...");
                rotateApiKey();
                continue;
              }
              throw new Error(result.error?.message ?? "Agent run failed");
            }
            
            // Successfully finished run
            break;
          } catch (err: any) {
            if (attempt < maxAttempts - 1) {
              console.warn("[improve] Agent exception, falling back to next model/key...");
              rotateApiKey();
              continue;
            }
            throw err;
          }
        }

        // Auto-extract new dependencies from code to prevent Agent forgetfulness
        const extracted = extractDependencies(patchedFiles);
        const finalDependencies = { ...(fileData.dependencies ?? {}) };
        
        extracted.forEach(pkg => {
          if (!finalDependencies[pkg]) finalDependencies[pkg] = "latest";
        });
        
        // Merge with BASE_DEPENDENCIES to ensure stable versions win
        const mergedDeps = {
          ...finalDependencies,
          ...BASE_DEPENDENCIES
        };

        // Remove problematic packages that crash Sandpack
        delete mergedDeps["tailwindcss"];
        delete mergedDeps["postcss"];
        delete mergedDeps["autoprefixer"];
        delete mergedDeps["react"];
        delete mergedDeps["react-dom"];

        const newFileData: FileData = {
          files: patchedFiles,
          dependencies: mergedDeps,
          title: fileData.title,
          envVars: fileData.envVars,
          suggestions: fileData.suggestions,
        };

        const userObjectId = new mongoose.Types.ObjectId(userId);

        await Workspace.findOneAndUpdate(
          { _id: workspaceId, userId: userObjectId },
          { fileData: newFileData }
        );

        await User.findByIdAndUpdate(userId, {
          $inc: { credits: -cost },
        });

        const updatedUser = await User.findById(userId).select("credits");

        enqueue(
          sseEvent("done", {
            fileData: newFileData,
            summary: finalSummary || result.outputText,
            creditsRemaining:
              updatedUser?.credits ?? user.credits - cost,
          })
        );
      } catch (err) {
        console.error("[improve] error:", err);
        enqueue(
          sseEvent("error", {
            message:
              err instanceof Error ? err.message : "Something went wrong.",
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
