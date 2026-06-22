// ─── Workspace & Chat Types ───────────────────────────────────────────────────

export type MessageRole = "user" | "assistant";

export interface Message {
  role: MessageRole;
  content: string;
  imageUrl?: string;
}

export interface FileData {
  files?: Record<string, { code: string }>;
  dependencies?: Record<string, string>;
  title?: string;
  suggestions?: string[];
  envVars?: Record<string, string>;
  projectSpec?: any;
}

export interface StatusStep {
  label: string;
  status: "running" | "done";
}

export interface VercelInfo {
  projectId?: string;
  projectName?: string;
  url?: string;
  deployedAt?: string;
}

export interface WorkspaceData {
  id: string;
  subdomain?: string;
  title: string | null;
  messages: unknown;
  fileData: unknown;
  vercel?: VercelInfo;
}

export interface WorkspaceUser {
  id: string;
  credits: number;
  plan: string;
}
