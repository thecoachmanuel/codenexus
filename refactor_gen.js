const fs = require('fs');

let code = fs.readFileSync('/Users/admin/Desktop/ai-app-builder/app/api/gen-ai-code/route.ts.bak', 'utf-8');

// 1. Add generateContent to imports
code = code.replace(
  'import { generateContentStream, DEFAULT_MODEL, PRO_MODEL } from "@/lib/gemini";',
  'import { generateContent, generateContentStream, DEFAULT_MODEL, PRO_MODEL } from "@/lib/gemini";'
);

// 2. We need to replace everything from `let rawJson = "";` to `const { assistantMessage, title: aiTitle, suggestions, files } = parsed;`
const targetStart = 'let rawJson = "";';
const targetEnd = 'const { assistantMessage, title: aiTitle, suggestions, files } = parsed;';

const newLogic = `
        let assistantMessage = "";
        let aiTitle: string | undefined = undefined;
        let suggestions: string[] = [];
        let files: Record<string, { code?: string; replacements?: Array<{ target: string; replacement: string }> }> | undefined = undefined;
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
            const chunk = await runGeminiPass(
              DEFAULT_MODEL,
              currentContents,
              getSystemPrompt(isExistingApp),
              (label) => enqueue(sseEvent("status", { message: loops > 1 ? "Writing massive codebase..." : label }))
            );
            
            let newChunk = chunk;
            if (loops > 1) {
              newChunk = newChunk.trimStart();
              if (newChunk.startsWith("\`\`\`json")) newChunk = newChunk.replace(/^\`\`\`json\\s*/i, "");
              else if (newChunk.startsWith("\`\`\`")) newChunk = newChunk.replace(/^\`\`\`[a-z]*\\s*/i, "");
            }
            rawJson += newChunk;
            
            let checkStr = rawJson.trim();
            if (checkStr.startsWith("\`\`\`json")) checkStr = checkStr.replace(/^\`\`\`json\\s*/i, "");
            else if (checkStr.startsWith("\`\`\`")) checkStr = checkStr.replace(/^\`\`\`[a-z]*\\s*/i, "");
            if (checkStr.endsWith("\`\`\`")) checkStr = checkStr.replace(/\`\`\`$/, "").trim();
            
            try {
              JSON.parse(checkStr);
              isComplete = true;
              rawJson = checkStr;
            } catch (e) {
              isComplete = false;
            }

            if (!isComplete) {
              enqueue(sseEvent("status", { message: "Writing massive codebase..." }));
              currentContents.push({ role: "model", parts: [{ text: chunk }] });
              currentContents.push({ role: "user", parts: [{ text: "Continue exactly where you left off." }] });
            }
          }

          const parsed = safeParseJSON<{
            assistantMessage: string;
            title?: string;
            suggestions?: string[];
            files?: Record<string, { code?: string; replacements?: Array<{ target: string; replacement: string }> }>;
          }>(rawJson);

          if (!parsed) {
            enqueue(sseEvent("error", { message: "Generation failed. Please try again." }));
            controller.close();
            return;
          }

          assistantMessage = parsed.assistantMessage;
          aiTitle = parsed.title;
          suggestions = parsed.suggestions || [];
          files = parsed.files;
          
        } else {
          // --- NEW APP: MULTI-AGENT SEQUENTIAL PIPELINE ---
          
          // Agent 1: Product Analyst
          enqueue(sseEvent("status", { message: "Product Analyst: Extracting requirements..." }));
          const analystPrompt = \`You are a Senior Product Analyst. Extract requirements from this prompt:
\${lastUserMessage.content}
Output strict JSON ONLY: { "requirements": "...", "pages": [...], "features": [...] }\`;
          
          const analystRes = await generateContent({ model: DEFAULT_MODEL, contents: [{ role: "user", parts: [{ text: analystPrompt }] }] });
          const analystJson = safeParseJSON<{ requirements: string, pages: string[], features: string[] }>(analystRes?.text() || "") || { requirements: lastUserMessage.content, pages: [], features: [] };
          
          // Agent 2: Project Architect
          enqueue(sseEvent("status", { message: "Project Architect: Designing architecture..." }));
          const architectPrompt = \`You are a Senior React Architect. Given these requirements:
\${JSON.stringify(analystJson)}
Design a Create-React-App project structure.
Constraints: React 18 compatible, NO Vite syntax, NO Next.js APIs, NO server code. Use Tailwind CSS.
Output strict JSON ONLY: { 
  "dependencies": ["lucide-react", "framer-motion", "clsx", "tailwind-merge"],
  "folderStructure": ["/package.json", "/src/index.js", "/src/App.js", "/src/components/Header.js"]
}\`;
          
          // Architect uses PRO_MODEL for deep reasoning
          const architectRes = await generateContent({ model: PRO_MODEL, contents: [{ role: "user", parts: [{ text: architectPrompt }] }] });
          const architectJson = safeParseJSON<{ dependencies: string[], folderStructure: string[] }>(architectRes?.text() || "") || { folderStructure: ["/package.json", "/src/index.js", "/src/App.js"], dependencies: ["lucide-react"] };
          
          // Set dependencies based on Architect
          architectJson.dependencies.forEach((dep: string) => { finalDependencies[dep] = "latest"; });
          
          files = {};
          let generatedSoFar: Record<string, string> = {};
          
          const filesToGenerate = architectJson.folderStructure;
          
          // Agent 3: Sequential File Generator
          for (const filepath of filesToGenerate) {
            enqueue(sseEvent("status", { message: \`File Generator: Writing \${filepath}...\` }));
            
            const generatorPrompt = \`You are an elite File Generator. Write the COMPLETE code for \${filepath}.
Project Requirements: \${JSON.stringify(analystJson)}
Dependencies Available: \${JSON.stringify(architectJson.dependencies)}
Other files generated so far: \${Object.keys(generatedSoFar).join(", ")}

Constraints:
1. ONLY React 18 browser-safe code. NO Next.js or Vite APIs.
2. Use default exports for components.
3. Apply premium UI/UX (framer-motion, tailwindcss, glassmorphism, rounded corners).
4. Do NOT output placeholders! Write the FULL, working file.
Output strict JSON ONLY: { "code": "..." }\`;
            
            const fileRes = await generateContent({ model: DEFAULT_MODEL, contents: [{ role: "user", parts: [{ text: generatorPrompt }] }] });
            const fileJson = safeParseJSON<{ code: string }>(fileRes?.text() || "");
            
            if (fileJson?.code) {
               files[filepath] = { code: fileJson.code };
               generatedSoFar[filepath] = fileJson.code;
               
               // Stream intermediate files to the UI directly
               enqueue(sseEvent("file_patch", { path: filepath, code: fileJson.code }));
            }
          }
          
          assistantMessage = "I have successfully architected and built your app file-by-file using the multi-agent pipeline!";
          aiTitle = "Generated Application";
          suggestions = ["Deploy to Vercel", "Add Authentication", "Add Dark Mode"];
        }
`;

const startIndex = code.indexOf(targetStart);
const endIndex = code.indexOf(targetEnd) + targetEnd.length;

if (startIndex === -1 || endIndex < targetStart.length) {
  console.error("Could not find targets");
  process.exit(1);
}

const finalCode = code.substring(0, startIndex) + newLogic + code.substring(endIndex);

fs.writeFileSync('/Users/admin/Desktop/ai-app-builder/app/api/gen-ai-code/route.ts', finalCode);
console.log("Successfully replaced generation logic!");
