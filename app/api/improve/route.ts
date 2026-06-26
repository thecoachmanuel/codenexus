import { getSession } from "@/lib/auth";
import { NextRequest } from "next/server";
import { extractDependencies } from "@/lib/dependencies";
import { BASE_DEPENDENCIES } from "@/lib/constants";
import { connectDB } from "@/lib/mongodb";
import User from "@/lib/models/User";
import Workspace from "@/lib/models/Workspace";
import { calculateImprovementCost } from "@/lib/credit-calculator";
import { generateContent, rotateApiKey, getModels } from "@/lib/gemini";
import { classifyError, validateAST } from "@/lib/validator";
import type { FileData } from "@/types/workspace";
import mongoose from "mongoose";

function sseEvent(type: string, payload: object): string {
  return `data: ${JSON.stringify({ type, ...payload })}\n\n`;
}

function safeParseJSON<T>(text: string): T | null {
  try {
    let cleaned = text;
    if (cleaned.includes("```json")) {
      cleaned = cleaned.split("```json")[1].split("```")[0];
    } else if (cleaned.includes("```")) {
      cleaned = cleaned.split("```")[1].split("```")[0];
    }
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleaned = cleaned.substring(firstBrace, lastBrace + 1);
      return JSON.parse(cleaned) as T;
    }
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return Response.json({ message: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { userId, workspaceId, userRequest, fileData, retryCount = 0 } = body as {
    userId: string;
    workspaceId: string;
    userRequest: string;
    fileData: FileData;
    retryCount?: number;
  };

  if (userId !== session.userId) return Response.json({ message: "Unauthorized" }, { status: 401 });

  await connectDB();
  const user = await User.findById(userId).select("_id credits plan");
  if (!user) return Response.json({ message: "User not found" }, { status: 404 });

  if (user.plan !== "pro") return Response.json({ message: "Upgrade required" }, { status: 403 });

  const cost = calculateImprovementCost(fileData, userRequest);
  if (user.credits < cost) {
    return Response.json({ message: `Insufficient credits. Need ${cost}, have ${user.credits}.` }, { status: 402 });
  }

  const isError = userRequest.includes("[COMPILER ERROR]");
  let errorType = "feature_request";
  if (isError) {
    errorType = classifyError(userRequest);
  }

  // Escalate to Pro if retryCount >= 2 or complex error
  const models = await getModels();
  const isProRequired = (isError && retryCount >= 2) || errorType === "build_failure" || errorType === "dependency_error";
  const modelToUse = isProRequired ? models.proModel : models.defaultModel;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (chunk: string) => controller.enqueue(encoder.encode(chunk));
      
      const patchedFiles: Record<string, { code: string }> = { ...(fileData.files ?? {}) };
      
      const systemPrompt = `You are a Senior React Debugger and Architect.
Your task is to analyze the user request and the provided files, and return a PATCH to fix the issue or add the feature.
Output strict JSON ONLY. Format:
{
  "fixType": "patch",
  "changes": [
    { "file": "/App.js", "action": "replace", "content": "..." }
  ],
  "reason": "..."
}
RULES:
1. "content" MUST be the ENTIRE updated file contents. Do NOT use placeholders!
2. Ensure React 18.2.0 compatibility. Use default exports. Use Tailwind CSS.
3. Path must start with / (e.g. /App.js).
4. If the error is unfixable, return action: "report" instead.
5. ENRICHED DESIGN (CRITICAL): Do not output plain or basic designs. Use highly vibrant, complementary color palettes (e.g. emerald, rose, indigo). All interactive elements MUST include framer-motion micro-interactions (e.g. whileHover, whileTap) and use rich styling like glassmorphism (backdrop-blur-md, borders, tinted shadows).
6. COMPILER ERRORS: If the user reports a missing dependency, you do NOT need to modify the code unless the import statement itself is incorrect. Dependencies are auto-installed. If the user reports an "illegal constructor" or generic runtime error, carefully review your previous AST. You likely used a browser API illegally (e.g. new Worker, new File) outside of a useEffect, or you generated an invalid React component structure.

CURRENT FILES:
${Object.entries(patchedFiles).map(([path, file]) => `--- ${path} ---\n${file.code}`).join("\n\n")}`;

      enqueue(sseEvent("status", { message: `Agent 5 (${isProRequired ? 'Pro' : 'Flash'}): Analyzing and patching...` }));

      let responseText = "";
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await generateContent({
            model: modelToUse,
            contents: [{ role: "user", parts: [{ text: `USER REQUEST:\n${userRequest}` }] }],
            config: { 
              systemInstruction: systemPrompt,
              responseMimeType: "application/json" 
            }
          });
          responseText = res?.text || "";
          if (responseText) break;
        } catch (err) {
          console.warn("[Agent 5 Error] Failed, rotating key...", err);
          rotateApiKey();
        }
      }

      const resultJson = safeParseJSON<{ fixType: string, changes: { file: string, action: string, content: string }[], reason: string }>(responseText);

      if (!resultJson || !resultJson.changes) {
        enqueue(sseEvent("done", {
          workspaceId,
          fileData,
          assistantMessage: "Failed to generate a valid patch. The error might be too complex or the AI encountered a safety block.",
          creditsRemaining: user.credits,
        }));
        controller.close();
        return;
      }

      const patchHistoryEntry = { request: userRequest, errorType, result: resultJson, timestamp: new Date() };

      for (const change of resultJson.changes) {
        if (change.action === "replace" && change.content) {
          let path = change.file;
          if (!path.startsWith("/")) path = "/" + path;
          
          // AST Validation before saving
          const validation = validateAST(change.content);
          if (!validation.isValid && modelToUse === models.defaultModel) {
            console.warn(`[Agent 5 Validator] Flash patch failed AST check: ${validation.message}`);
            // Let the UI know, it will loop if retryCount < 2
          }

          patchedFiles[path] = { code: change.content };
          enqueue(sseEvent("file_patch", { path, code: change.content, reason: resultJson.reason }));
        }
      }

      const extracted = extractDependencies(patchedFiles);
      const finalDependencies = { ...(fileData.dependencies ?? {}) };
      extracted.forEach(pkg => {
        if (!finalDependencies[pkg]) finalDependencies[pkg] = "latest";
      });
      const mergedDeps = { ...finalDependencies, ...BASE_DEPENDENCIES };
      delete mergedDeps["tailwindcss"];
      delete mergedDeps["react"];
      delete mergedDeps["react-dom"];

      const newFileData: FileData = {
        files: patchedFiles,
        dependencies: mergedDeps,
        title: fileData.title,
        envVars: fileData.envVars,
        suggestions: fileData.suggestions,
      };

      await Workspace.findOneAndUpdate(
        { _id: new mongoose.Types.ObjectId(workspaceId) },
        { 
          fileData: newFileData,
          $push: { patchHistory: patchHistoryEntry }
        }
      );

      // Deduct credits
      user.credits -= cost;
      await user.save();

      enqueue(sseEvent("done", {
        workspaceId,
        fileData: newFileData,
        assistantMessage: resultJson.reason || "I have applied the necessary fixes.",
        creditsRemaining: user.credits,
      }));

      controller.close();
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
