import { getSession } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import User from "@/lib/models/User";
import Workspace from "@/lib/models/Workspace";
import { generateContentStream, DEFAULT_MODEL, PRO_MODEL } from "@/lib/gemini";
import { calculateGenerationCost } from "@/lib/credit-calculator";
import { extractDependencies, findMissingFiles, autoFixAbsoluteImports, autoStubMissingFiles } from "@/lib/dependencies";
import { BASE_DEPENDENCIES, FULLSTACK_BOILERPLATE } from "@/lib/constants";
import type { Message, FileData } from "@/types/workspace";
import mongoose from "mongoose";

// ─── SSE helper ───────────────────────────────────────────────────────────────

function sseEvent(type: string, payload: unknown) {
  return { type, ...(payload as object) };
}

// ─── History trimming ─────────────────────────────────────────────────────────

function trimHistory(messages: Message[]): Message[] {
  if (messages.length <= 10) return messages;
  return [messages[0], ...messages.slice(-8)];
}

// ─── System Prompts ───────────────────────────────────────────────────────────

const getSystemPrompt = () => `You are an elite, Principal Fullstack Architect with over 20 years of industry experience. Generate a complete, working fullstack application. You possess deep wisdom in building scalable, production-grade architectures.

OUTPUT: Respond using the EXACT XML artifact format below. Do not include any other markdown or conversational text outside of this artifact structure.

<boltArtifact title="<short 2-4 word title>" suggestions="Add dark mode, Implement settings, Add sample data">
  <boltAction type="file" filePath="/package.json">
{
  "name": "generated-app",
  "scripts": { "dev": "vite", "start": "node server.js" },
  "dependencies": { "lucide-react": "latest", "react": "latest" }
}
  </boltAction>
  <boltAction type="file" filePath="/src/App.jsx">
export default function App() { return <div>Hello</div>; }
  </boltAction>
</boltArtifact>

RULES:
1. You may build fullstack applications (e.g., Next.js, Vite + Express, Node.js). Use JavaScript or TypeScript.
2. IMPORTANT: You are generating code for a WebContainer (a real Node.js environment). You MUST generate a valid \`/package.json\` with all dependencies.
3. CRITICAL PORT BINDING: The \`dev\` or \`start\` script MUST bind to \`0.0.0.0\`. 
   - For Vite: \`"dev": "vite --host 0.0.0.0"\`
   - For Next.js: \`"dev": "next dev -H 0.0.0.0"\`
   - For Express/Node: \`app.listen(3000, '0.0.0.0', ...)\`
3. Use modern, clean architecture. Put components in \`/components\`, pages in \`/pages\` (or \`/app\` for Next.js), hooks in \`/hooks\`, and utils in \`/lib\`.
4. Use Tailwind CSS for styling. You must configure Tailwind properly in the files (e.g., \`tailwind.config.js\`, \`postcss.config.js\`, and the main CSS file).
5. All imports must reference files you include or valid npm packages listed in your \`package.json\`.
6. For placeholders and images, dynamically fetch descriptive images using the pollinations.ai API (e.g. https://image.pollinations.ai/prompt/a%20beautiful%20landscape).
7. NEVER use local image paths. For images use: https://image.pollinations.ai/prompt/{keyword}?width=800&height=600&nologo=true or https://placehold.co/600x400/png
8. **DATABASE**: If the user requests a database, you may use MongoDB with Mongoose, PostgreSQL, or any Node.js compatible database, as this runs in a real Node backend.
9. **DEPLOYMENT**: ALWAYS include a /README.md detailing exactly how to run the app.
10. **SURGICAL REPLACEMENTS (CRITICAL)**: If the user is modifying an EXISTING app, you MUST output the ENTIRE modified file contents using the file action. We no longer use diffs. You must rewrite the file fully with the bug fixed.
11. **NO STUBS OR PLACEHOLDERS**: When using the \`code\` format, you MUST output the ENTIRE, fully-featured file contents. NEVER use placeholders like \`// ... existing code\`. If you output a stub, you will delete the user's existing code and break the app!
12. **COMPLEX TASK SPLITTING**: Build a simple Minimum Viable Product (MVP) first. Do not attempt to write 100 files at once.
13. **MOBILE-FIRST & RESPONSIVE**: Design the application to be highly responsive.
14. **LIGHT MODE DEFAULT**: Design the application in light mode by default unless requested.
15. **SENIOR UI/UX DESIGNER**: Use premium, state-of-the-art designs. Use framer-motion heavily.
16. **CRITICAL EXPORTS & IMPORTS**: You MUST use \`export default\` for ALL your components, hooks, and utilities. NEVER use named exports!
`;

// ─── Contents builder ─────────────────────────────────────────────────────────

function buildFrontendContents(messages: Message[], fileData: FileData | null) {
  const trimmed = trimHistory(messages);

  return trimmed.map((msg, idx) => {
    const role = msg.role === "assistant" ? "model" : "user";

    if (msg.role === "user") {
      const parts: any[] = [];
      let text = msg.content;

      const isLast = idx === trimmed.length - 1;
      if (isLast && fileData) {
        let fileEntries = Object.entries(fileData.files ?? {});
        let fileSummary = "";
        let charCount = 0;
        const MAX_CHARS = 35000;

        for (const [path, fileObj] of fileEntries) {
          const code = (fileObj as any).code || "";
          const entry = `### ${path}\n\`\`\`\n${code}\n\`\`\`\n\n`;
          if (charCount + entry.length > MAX_CHARS) {
             fileSummary += `\n\n[System: Additional older files omitted from context to save tokens.]`;
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

// ─── Streaming Artifact Parser ────────────────────────────────────────────────

interface ParsedArtifact {
  title?: string;
  suggestions: string[];
  files: Record<string, { code: string }>;
}

async function runGeminiArtifactStream(
  model: string,
  contents: object[],
  systemInstruction: string,
  enqueue: (data: any) => void
): Promise<ParsedArtifact> {
  const geminiStream = await generateContentStream({
    model: model,
    contents,
    config: {
      systemInstruction,
      temperature: 0.7,
    },
  });

  let accumulated = "";
  let artifact: ParsedArtifact = { files: {}, suggestions: [] };
  
  let isInsideArtifact = false;
  let isInsideAction = false;
  let currentFilePath = "";
  let currentFileCode = "";

  for await (const chunk of geminiStream) {
    const parts = chunk.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      if (!part.text) continue;
      accumulated += part.text;

      // Extract Artifact Metadata (once)
      if (!isInsideArtifact && accumulated.includes("<boltArtifact")) {
        isInsideArtifact = true;
        const titleMatch = accumulated.match(/title="([^"]+)"/);
        if (titleMatch) artifact.title = titleMatch[1];
        
        const suggMatch = accumulated.match(/suggestions="([^"]+)"/);
        if (suggMatch) {
           artifact.suggestions = suggMatch[1].split(',').map(s => s.trim()).filter(Boolean);
        }
        enqueue(sseEvent("status", { message: "Generating project structure..." }));
      }

      // Check for action open
      if (isInsideArtifact && !isInsideAction) {
        const actionMatch = accumulated.match(/<boltAction[^>]*filePath="([^"]+)"[^>]*>/);
        if (actionMatch) {
          isInsideAction = true;
          currentFilePath = actionMatch[1];
          currentFileCode = "";
          // Clear everything before and including the opening tag
          accumulated = accumulated.substring(accumulated.indexOf(actionMatch[0]) + actionMatch[0].length);
          enqueue(sseEvent("status", { message: `Writing ${currentFilePath}...` }));
        }
      }

      // Check for action close
      if (isInsideAction) {
        const closeIdx = accumulated.indexOf("</boltAction>");
        if (closeIdx !== -1) {
          currentFileCode += accumulated.substring(0, closeIdx);
          
          let code = currentFileCode.trim();
          if (code.startsWith("```")) {
             code = code.replace(/^```[a-z]*\n/i, "");
             if (code.endsWith("```")) code = code.substring(0, code.length - 3).trim();
          }

          artifact.files[currentFilePath] = { code };
          
          let normalizedPath = currentFilePath;
          if (!normalizedPath.startsWith("/")) normalizedPath = "/" + normalizedPath;
          enqueue(sseEvent("file_patch", { path: normalizedPath, code }));

          isInsideAction = false;
          currentFilePath = "";
          currentFileCode = "";
          accumulated = accumulated.substring(closeIdx + "</boltAction>".length);
        } else {
          // Send all but the last 20 chars to currentFileCode to avoid splitting </boltAction>
          if (accumulated.length > 20) {
            const flush = accumulated.substring(0, accumulated.length - 20);
            currentFileCode += flush;
            accumulated = accumulated.substring(accumulated.length - 20);
            
            // emit partial file update for live UI typing
            let partialCode = currentFileCode;
            if (partialCode.startsWith("```")) {
               partialCode = partialCode.replace(/^```[a-z]*\n/i, "");
            }
            let normalizedPath = currentFilePath;
            if (!normalizedPath.startsWith("/")) normalizedPath = "/" + normalizedPath;
            enqueue(sseEvent("file_patch", { path: normalizedPath, code: partialCode }));
          }
        }
      }
    }
  }

  return artifact;
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function generateWorkspaceTask(
  { workspaceId, userId, messages, fileData, retryCount }: { workspaceId: string | null; userId: string; messages: Message[]; fileData: FileData | null; retryCount?: number },
  externalEnqueue: (type: string, payload: any) => void
) {
  await connectDB();

  const user = await User.findById(userId).select("_id credits");
  if (!user) throw new Error("User not found");
    
  const cost = calculateGenerationCost(messages);
  if (user.credits < cost) {
    throw new Error(`Insufficient credits. This complex task requires ${cost} credits, but you only have ${user.credits}.`);
  }

  const enqueue = (data: any) => {
    const { type, ...payload } = data;
    externalEnqueue(type, payload);
  };

  try {
    enqueue(sseEvent("status", { message: "Thinking…" }));

    const contents = buildFrontendContents(messages, fileData);
    const targetModel = (retryCount ?? 0) >= 3 ? PRO_MODEL : DEFAULT_MODEL;

    // Run Single-Shot Artifact Generation
    const artifact = await runGeminiArtifactStream(
      targetModel,
      contents,
      getSystemPrompt(),
      enqueue
    );

    if (Object.keys(artifact.files).length === 0) {
       throw new Error("Failed to generate files. The AI didn't return a valid artifact.");
    }

    const aiTitle = artifact.title || "Generated App";
    const suggestions = artifact.suggestions.length > 0 ? artifact.suggestions : ["Deploy to Vercel", "Add Authentication"];
    const assistantMessage = "I have successfully built your application using the robust single-shot artifact stream!";

    // ── Merge existing files with new files ────────────────────────────────
    const baseWorkspace: Record<string, { code: string }> = { ...(fileData?.files ?? {}) };
    const normalizedFiles: Record<string, { code: string }> = { ...baseWorkspace };
    
    for (const [key, value] of Object.entries(artifact.files)) {
      let path = key;
      if (!path.startsWith("/")) path = "/" + path;
      normalizedFiles[path] = value;
    }
    
    // Ensure robustness with AST extraction and auto stubbing
    autoFixAbsoluteImports(normalizedFiles);
    const missing = findMissingFiles(normalizedFiles);
    if (missing.length > 0) {
      autoStubMissingFiles(normalizedFiles, missing);
    }

    enqueue(sseEvent("status", { message: "Extracting packages…" }));
    let finalDependencies: Record<string, string> = { ...(fileData?.dependencies ?? {}) };
    
    // Check if AI generated a package.json and extract deps from it
    const pkgJsonStr = normalizedFiles["/package.json"]?.code;
    if (pkgJsonStr) {
       try {
          const pkg = JSON.parse(pkgJsonStr);
          if (pkg.dependencies) {
             finalDependencies = { ...finalDependencies, ...pkg.dependencies };
          }
          if (pkg.devDependencies) {
             finalDependencies = { ...finalDependencies, ...pkg.devDependencies };
          }
       } catch(e) {}
    }

    const extracted = extractDependencies(normalizedFiles);
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
      const subdomain = "app-" + Math.random().toString(36).substring(2, 9);
      workspace = await Workspace.create({
        userId: userObjectId,
        title: aiTitle,
        subdomain,
        messages: updatedMessages,
        fileData: newFileData,
      });
    }

    if (!workspace) throw new Error("Failed to save workspace");

    // Deduct credits
    await User.updateOne({ _id: userObjectId }, { $inc: { credits: -cost } });

    enqueue(sseEvent("status", { message: "Complete!" }));
    enqueue(sseEvent("done", { workspaceId: workspace._id.toString() }));

  } catch (error: any) {
    console.error("Workspace generation error:", error);
    enqueue(sseEvent("error", { message: error.message || "An error occurred during generation." }));
  }
}
