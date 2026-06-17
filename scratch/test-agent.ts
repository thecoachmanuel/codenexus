import { Agent, createTool } from "@cline/sdk";
import { z } from "zod";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function run() {
  const updateFileTool = createTool({
    name: "update_file",
    description: "Update a file.",
    inputSchema: z.object({
      path: z.string(),
      code: z.string(),
      reason: z.string(),
    }),
    async execute({ path, code, reason }) {
      console.log(`Tool called: ${path}`);
      return `Updated ${path}`;
    },
  });

  const doneTool = createTool({
    name: "done_improving",
    description: "Call this when done.",
    inputSchema: z.object({
      summary: z.string(),
    }),
    lifecycle: { completesRun: true },
    async execute({ summary }) {
      console.log(`Done: ${summary}`);
      return "Done.";
    },
  });

  const agent = new Agent({
    providerId: "gemini",
    modelId: "gemini-2.5-flash",
    apiKey: process.env.GEMINI_API_KEY_1 || process.env.GEMINI_API_KEY || "dummy",
    maxIterations: 3,
    systemPrompt: "You are an expert. Please update /App.js with a console.log and call done_improving.",
    tools: [updateFileTool, doneTool],
    toolPolicies: {
      update_file: { autoApprove: true },
      done_improving: { autoApprove: true },
    },
  });

  console.log("Agent starting...");
  
  agent.subscribe((event) => {
    console.log("Event:", event.type);
  });

  try {
    const result = await agent.run("Please add a console log to App.js");
    console.log("Result:", result.status);
  } catch (err) {
    console.error("Error:", err);
  }
}

run();
