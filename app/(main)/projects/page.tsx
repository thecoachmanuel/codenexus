"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Zap, GitBranch } from "lucide-react";
import { ProjectCard } from "@/components/ProjectCard";
import Link from "next/link";
import { getUserProjects } from "@/actions/projects";
import { BlueTitle } from "@/components/reusables";
import { Button } from "@/components/ui/button";
import { GitHubImportModal } from "@/components/GitHubImportModal";
import type { FileData } from "@/types/workspace";

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-32 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-white/20 bg-white/4">
        <Zap className="h-5 w-5 text-white/40" />
      </div>
      <p className="mb-1 text-base font-medium text-white/70">No projects yet</p>
      <p className="mb-6 text-sm text-white/40">
        Head to the homepage and describe what you want to build.
      </p>
      <Link
        href="/"
        className="inline-flex h-8 items-center gap-1.5 rounded-full bg-white px-4 text-[13px] font-semibold text-black transition-opacity hover:opacity-90"
      >
        Start building
      </Link>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Awaited<ReturnType<typeof getUserProjects>>>([]);
  const [userPlan, setUserPlan] = useState<string>("free");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await getUserProjects();
        setProjects(data);
        // Get user plan from /api/auth/me
        const meRes = await fetch("/api/auth/me");
        if (meRes.ok) {
          const me = await meRes.json();
          setUserPlan(me.user?.plan ?? "free");
        }
      } catch {
        router.push("/sign-in");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [router]);

  const handleGitHubImport = (fileData: FileData, repoName: string) => {
    // Store in sessionStorage so the workspace page can pick it up
    sessionStorage.setItem("github_import", JSON.stringify({ fileData, repoName }));
    router.push("/workspace");
  };

  return (
    <main className="min-h-screen bg-[#0a0a0a] px-4 py-10">
      <div className="mx-auto max-w-5xl">
        {/* Header */}
        <div className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <BlueTitle className="text-4xl sm:text-5xl md:text-6xl break-words">Projects</BlueTitle>
            <p className="mt-3 text-base text-white/60">
              All your AI-generated apps in one place.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* GitHub Import Button */}
            <GitHubImportModal
              isProUser={userPlan === "pro"}
              onImport={handleGitHubImport}
            >
              <Button variant="ghost" className="cursor-pointer border border-white/20 bg-white/5 text-white/80 hover:bg-white/10 hover:text-white">
                <GitBranch className="h-3.5 w-3.5" />
                Import from GitHub
              </Button>
            </GitHubImportModal>

            <Link href="/">
              <Button className="cursor-pointer">
                <Zap className="h-3 w-3 fill-black" />
                New project
              </Button>
            </Link>
          </div>
        </div>

        {/* Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-32">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
          </div>
        ) : projects.length === 0 ? (
          <EmptyState />
        ) : (
          <ProjectCard 
            projects={projects} 
            onDelete={(id) => setProjects(prev => prev.filter(p => p.id !== id))}
          />
        )}
      </div>
    </main>
  );
}
