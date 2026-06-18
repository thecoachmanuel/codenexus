// ─── Task Graph Types ─────────────────────────────────────────────────────────

export type TaskType = "config" | "pages" | "api" | "components" | "lib" | "styles" | "db" | "test";
export type TaskStatus = "pending" | "running" | "done" | "failed";

export interface Task {
  id: string;
  name: string;
  description: string;
  type: TaskType;
  dependsOn: string[]; // task ids
  files: string[];     // file paths this task will generate
  status: TaskStatus;
  error?: string;
}

export interface TaskGraph {
  framework: "nextjs";
  appName: string;
  description: string;
  tasks: Task[];
  dependencies: Record<string, string>;    // npm deps for the generated app
  devDependencies: Record<string, string>; // npm devDeps for the generated app
  startCommand: string;
  hasDatabase: boolean;
}

// ─── Generated File Types ─────────────────────────────────────────────────────

export interface FullstackFileData {
  files: Record<string, string>;           // path → raw file content (not wrapped)
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  startCommand: string;
  appName: string;
}

// ─── SSE Event Types (server → client) ───────────────────────────────────────

export type FullstackSSEEvent =
  | { type: "status"; message: string }
  | { type: "task_graph"; taskGraph: TaskGraph }
  | { type: "task_started"; taskId: string; taskName: string }
  | { type: "task_done"; taskId: string; taskName: string }
  | { type: "task_failed"; taskId: string; taskName: string; error: string }
  | { type: "file_written"; path: string; taskId: string }
  | { type: "thinking"; text: string }
  | { type: "file_patch"; path: string; code: string }
  | { type: "done"; fileData: FullstackFileData; creditsRemaining: number }
  | { type: "error"; message: string };

// ─── WebContainer State ───────────────────────────────────────────────────────

export type ContainerStatus =
  | "idle"
  | "booting"
  | "writing"
  | "installing"
  | "starting"
  | "ready"
  | "error";

export interface ContainerState {
  status: ContainerStatus;
  previewUrl: string | null;
  log: string[];
  error: string | null;
}
