import fs from 'fs';

const routeContent = `import { getSession } from "@/lib/auth";
import { NextRequest } from "next/server";
import { connectDB } from "@/lib/mongodb";
import User from "@/lib/models/User";
import Workspace from "@/lib/models/Workspace";
import { generateContent, generateContentStream, DEFAULT_MODEL, PRO_MODEL } from "@/lib/gemini";
import { calculateGenerationCost } from "@/lib/credit-calculator";
import { extractDependencies, findMissingFiles, autoFixAbsoluteImports, autoStubMissingFiles } from "@/lib/dependencies";
import { BASE_DEPENDENCIES, REACT_BOILERPLATE } from "@/lib/constants";
import type { Message, FileData } from "@/types/workspace";
import mongoose from "mongoose";

function sseEvent(type: string, payload: unknown): string {
  return \`data: \${JSON.stringify({ type, ...(payload as object) })}\\n\\n\`;
}

function trimHistory(messages: Message[]): Message[] {
  if (messages.length <= 10) return messages;
  return [messages[0], ...messages.slice(-8)];
}

function safeParseJSON<T>(raw: string): T | null {
  let cleaned = raw.trim();
  if (cleaned.startsWith("\`\`\`json")) cleaned = cleaned.replace(/^\`\`\`json\\s*/i, "").replace(/\\s*\`\`\`$/i, "");
  else if (cleaned.startsWith("\`\`\`")) cleaned = cleaned.replace(/^\`\`\`[a-z]*\\s*/i, "").replace(/\\s*\`\`\`$/i, "");

  try { return JSON.parse(cleaned) as T; } catch {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      try { return JSON.parse(cleaned.substring(firstBrace, lastBrace + 1)) as T; } catch { return null; }
    }
    return null;
  }
}

const MIN_CREDITS_TO_GENERATE = 5;
const SYSTEM_INSTRUCTION_EXISTING = \`You are an elite React Developer. Modify the existing Create-React-App project surgically.
OUTPUT STRICT JSON:
{
  "assistantMessage": "description",
  "suggestions": ["Next step 1"],
  "files": {
    "/components/App.js": {
      "replacements": [{ "target": "old code", "replacement": "new code" }]
    }
  }
}\`;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.userId) return new Response("Unauthorized", { status: 401 });

  const body = await req.json();
  const { workspaceId, messages, fileData } = body as { workspaceId?: string; userId: string; messages: Message[]; fileData: FileData | null; };
  const userId = session.userId;

  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (text: string) => {
        try { controller.enqueue(new TextEncoder().encode(text)); } catch {}
      };

      try {
        await connectDB();
        const user = await User.findById(userId).select("credits");
        if (!user || user.credits < MIN_CREDITS_TO_GENERATE) {
          enqueue(sseEvent("error", { message: "Insufficient credits." }));
          return controller.close();
        }

        const cost = calculateGenerationCost(messages, fileData);
        let normalizedFiles: Record<string, { code: string }> = {};
        let aiTitle = "";
        let assistantMessage = "";
        let suggestions: string[] = [];

        const isExistingApp = !!(fileData?.files && Object.keys(fileData.files).length > 0);
        const lastUserMessage = messages[messages.length - 1];

        if (isExistingApp) {
          // Standard Single-Shot Patcher for existing apps
          enqueue(sseEvent("status", { message: "Applying surgical patches..." }));
          
          let rawJson = "";
          const resStream = await generateContentStream({
            model: DEFAULT_MODEL,
            contents: [{ role: "user", parts: [{ text: JSON.stringify(fileData) }, { text: lastUserMessage.content }] }],
            config: { systemInstruction: SYSTEM_INSTRUCTION_EXISTING, responseMimeType: "application/json" }
          });
          
          for await (const chunk of resStream) {
            const parts = chunk.candidates?.[0]?.content?.parts ?? [];
            if (parts[0]?.text) rawJson += parts[0].text;
          }

          const parsed = safeParseJSON<{ files: Record<string, any>; assistantMessage: string; suggestions: string[] }>(rawJson);
          if (!parsed) throw new Error("Failed to parse AI response.");
          
          assistantMessage = parsed.assistantMessage || "Updated your app.";
          suggestions = parsed.suggestions || [];
          
          // Apply replacements
          normalizedFiles = { ...fileData!.files };
          for (const [path, changes] of Object.entries(parsed.files || {})) {
            if (changes.code) {
              normalizedFiles[path] = { code: changes.code };
              enqueue(sseEvent("file_patch", { path, code: changes.code }));
            } else if (changes.replacements) {
              let code = normalizedFiles[path]?.code || "";
              changes.replacements.forEach((r: any) => { code = code.replace(r.target, r.replacement); });
              normalizedFiles[path] = { code };
              enqueue(sseEvent("file_patch", { path, code }));
            }
          }
        } else {
          // ─── NEW MULTI-AGENT PIPELINE FOR BRAND NEW APPS ───
          enqueue(sseEvent("status", { message: "Agent 1: Analyzing requirements..." }));
          const analystRes = await generateContent({
            model: DEFAULT_MODEL,
            contents: [{ role: "user", parts: [{ text: \`Extract requirements: \${lastUserMessage.content}\` }] }],
            config: { systemInstruction: "Output JSON: { \\"requirements\\": \\"...\\", \\"pages\\": [...], \\"features\\": [...] }", responseMimeType: "application/json" }
          });
          const analystJson = safeParseJSON<any>(analystRes.text()) || {};

          enqueue(sseEvent("status", { message: "Agent 2: Architecting project..." }));
          const architectRes = await generateContent({
            model: PRO_MODEL, // Use PRO for architecture as per rules
            contents: [{ role: "user", parts: [{ text: \`Design CRA React 18 app architecture based on: \${JSON.stringify(analystJson)}\` }] }],
            config: { systemInstruction: "Output JSON: { \\"dependencies\\": [\\"lucide-react\\", ...], \\"folderStructure\\": [\\"/package.json\\", \\"/src/index.js\\", \\"/src/App.js\\", ...] }", responseMimeType: "application/json" }
          });
          const architectJson = safeParseJSON<any>(architectRes.text()) || {};
          
          const filesToGenerate = architectJson.folderStructure || ["/package.json", "/src/index.js", "/src/App.js"];
          normalizedFiles = { ...REACT_BOILERPLATE };
          
          for (const filepath of filesToGenerate) {
            enqueue(sseEvent("status", { message: \`Agent 3: Generating \${filepath}...\` }));
            const genPrompt = \`Write FULL code for \${filepath}. 
Requirements: \${JSON.stringify(analystJson)}
Already written: \${Object.keys(normalizedFiles).join(", ")}\`;

            const fileRes = await generateContent({
              model: DEFAULT_MODEL,
              contents: [{ role: "user", parts: [{ text: genPrompt }] }],
              config: { systemInstruction: "Output JSON: { \\"code\\": \\"...\\" }. Ensure default exports and standard CRA syntax.", responseMimeType: "application/json" }
            });
            const fileJson = safeParseJSON<{code: string}>(fileRes.text());
            
            if (fileJson?.code) {
              normalizedFiles[filepath] = { code: fileJson.code };
              enqueue(sseEvent("file_patch", { path: filepath, code: fileJson.code }));
            }
          }
          
          aiTitle = "Generated App";
          assistantMessage = "I have finished generating your app file-by-file!";
          suggestions = ["Deploy to Vercel", "Add authentication"];
        }

        const newFileData: FileData = {
          files: normalizedFiles,
          dependencies: fileData?.dependencies || {},
          title: aiTitle || fileData?.title,
          suggestions,
        };

        enqueue(sseEvent("status", { message: "Saving…" }));

        const updatedMessages = [...messages, { role: "assistant", content: assistantMessage }];
        const userObjectId = new mongoose.Types.ObjectId(userId);
        
        let workspace = workspaceId 
          ? await Workspace.findOneAndUpdate({ _id: workspaceId, userId: userObjectId }, { messages: updatedMessages, fileData: newFileData }, { new: true })
          : await Workspace.create({ userId: userObjectId, title: aiTitle || "New App", subdomain: "app-" + Math.random().toString(36).substring(2, 9), messages: updatedMessages, fileData: newFileData });

        await User.findByIdAndUpdate(userId, { $inc: { credits: -cost } });
        const updatedUser = await User.findById(userId).select("credits");

        enqueue(sseEvent("done", {
          workspaceId: workspace!._id.toString(),
          subdomain: workspace!.subdomain,
          assistantMessage,
          fileData: newFileData,
          creditsRemaining: updatedUser?.credits ?? user.credits - cost,
        }));
      } catch (err) {
        enqueue(sseEvent("error", { message: err instanceof Error ? err.message : "Error." }));
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
}
`;

fs.writeFileSync('/Users/admin/Desktop/ai-app-builder/scratch_route.ts', routeContent);
