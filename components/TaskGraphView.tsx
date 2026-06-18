import { CheckCircle2, Circle, Loader2, XCircle } from "lucide-react";
import type { TaskGraph, Task } from "@/types/fullstack";

export function TaskGraphView({ taskGraph }: { taskGraph: TaskGraph }) {
  if (!taskGraph || !taskGraph.tasks) return null;

  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="border-b border-white/10 pb-4">
        <h3 className="font-semibold text-white">{taskGraph.appName}</h3>
        <p className="text-gray-400 mt-1">{taskGraph.description}</p>
        <div className="flex items-center gap-2 mt-3">
          <span className="px-2 py-0.5 rounded-full bg-white/5 text-xs text-gray-300 font-medium">
            Next.js App Router
          </span>
          <span className="px-2 py-0.5 rounded-full bg-white/5 text-xs text-gray-300 font-medium">
            WebContainers
          </span>
          {taskGraph.hasDatabase && (
            <span className="px-2 py-0.5 rounded-full bg-blue-500/10 text-xs text-blue-400 font-medium">
              NeDB Attached
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          Task Execution Plan
        </h4>
        {taskGraph.tasks.map((task) => (
          <TaskItem key={task.id} task={task} />
        ))}
      </div>
    </div>
  );
}

function TaskItem({ task }: { task: Task }) {
  return (
    <div className="flex flex-col gap-2 p-3 rounded-lg border border-white/5 bg-[#121212]">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <TaskIcon status={task.status} />
          <span className="text-gray-200 font-medium">{task.name}</span>
        </div>
        <span className="text-xs font-mono text-gray-500">{task.type}</span>
      </div>
      <p className="text-gray-400 text-xs ml-7">{task.description}</p>
      
      {task.files.length > 0 && (
        <div className="ml-7 mt-2 flex flex-col gap-1 border-l border-white/10 pl-3">
          {task.files.map((file) => (
            <div key={file} className="text-xs font-mono text-gray-500">
              {task.status === "done" ? "✓" : "•"} {file}
            </div>
          ))}
        </div>
      )}
      
      {task.error && (
        <div className="ml-7 mt-2 text-xs text-red-400 bg-red-400/10 p-2 rounded">
          {task.error}
        </div>
      )}
    </div>
  );
}

function TaskIcon({ status }: { status: Task["status"] }) {
  switch (status) {
    case "done":
      return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
    case "running":
      return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
    case "failed":
      return <XCircle className="w-4 h-4 text-red-500" />;
    default:
      return <Circle className="w-4 h-4 text-gray-600" />;
  }
}
