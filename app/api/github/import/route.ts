import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

// ─── Config ───────────────────────────────────────────────────────────────────
const DEFAULT_FILE_LIMIT = 50;
const MAX_FILE_SIZE_BYTES = 200_000; // 200 KB per file — skip larger binaries
const ALLOWED_EXTENSIONS = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".css", ".scss", ".sass", ".less",
  ".html", ".htm", ".json", ".md", ".mdx", ".svg", ".txt", ".env.example",
  ".yaml", ".yml", ".graphql", ".gql", ".prisma",
]);
const SKIP_PATHS = new Set(["node_modules", ".git", ".next", "dist", "build", ".cache", "coverage"]);

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parseRepoUrl(url: string): { owner: string; repo: string; branch: string | null } | null {
  try {
    const u = new URL(url.trim());
    if (u.hostname !== "github.com") return null;
    const parts = u.pathname.replace(/^\//, "").split("/");
    if (parts.length < 2) return null;
    const owner = parts[0];
    const repo = parts[1].replace(/\.git$/, "");
    // Support /tree/<branch> URLs
    const branch = parts[2] === "tree" && parts[3] ? parts[3] : null;
    return { owner, repo, branch };
  } catch {
    return null;
  }
}

function shouldSkipPath(path: string): boolean {
  return path.split("/").some((segment) => SKIP_PATHS.has(segment));
}

function isAllowedExtension(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot === -1) {
    // Allow known no-extension files
    const filename = path.split("/").pop() ?? "";
    return ["Dockerfile", "Makefile", ".env.example", ".gitignore"].includes(filename);
  }
  const ext = path.slice(dot).toLowerCase();
  return ALLOWED_EXTENSIONS.has(ext);
}

// ─── Route ────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  // 1. Auth check
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  // 2. Pro plan check
  if (session.plan !== "pro") {
    return NextResponse.json(
      { message: "GitHub import is a Pro feature. Upgrade to Pro to use it." },
      { status: 403 }
    );
  }

  // 3. Parse body
  const { repoUrl, fileLimit } = await req.json() as {
    repoUrl: string;
    fileLimit?: number;
  };

  if (!repoUrl) {
    return NextResponse.json({ message: "repoUrl is required" }, { status: 400 });
  }

  const parsed = parseRepoUrl(repoUrl);
  if (!parsed) {
    return NextResponse.json(
      { message: "Invalid GitHub URL. Use: https://github.com/owner/repo" },
      { status: 400 }
    );
  }

  const { owner, repo, branch } = parsed;
  const limit = Math.min(fileLimit ?? DEFAULT_FILE_LIMIT, 500);

  // 4. Resolve default branch if not specified
  let defaultBranch = branch;
  if (!defaultBranch) {
    const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    });
    if (!repoRes.ok) {
      if (repoRes.status === 404) {
        return NextResponse.json({ message: "Repository not found or is private." }, { status: 404 });
      }
      return NextResponse.json({ message: "Failed to reach GitHub API." }, { status: 502 });
    }
    const repoData = await repoRes.json();
    defaultBranch = repoData.default_branch ?? "main";
  }

  // 5. Fetch file tree (recursive)
  const treeRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${defaultBranch}?recursive=1`,
    {
      headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    }
  );

  if (!treeRes.ok) {
    return NextResponse.json({ message: "Failed to fetch repository tree." }, { status: 502 });
  }

  const treeData = await treeRes.json();
  const allBlobs: Array<{ path: string; url: string; size: number }> = (treeData.tree ?? [])
    .filter(
      (item: { type: string; path: string; size?: number; url: string }) =>
        item.type === "blob" &&
        !shouldSkipPath(item.path) &&
        isAllowedExtension(item.path) &&
        (item.size ?? 0) < MAX_FILE_SIZE_BYTES
    )
    .slice(0, limit);

  if (allBlobs.length === 0) {
    return NextResponse.json(
      { message: "No supported source files found in this repository." },
      { status: 422 }
    );
  }

  // 6. Fetch file contents in parallel (batched to avoid rate limits)
  const BATCH_SIZE = 10;
  const files: Record<string, { code: string }> = {};

  for (let i = 0; i < allBlobs.length; i += BATCH_SIZE) {
    const batch = allBlobs.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (blob) => {
        const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${defaultBranch}/${blob.path}`;
        const res = await fetch(rawUrl);
        if (!res.ok) return;
        const text = await res.text();
        files[`/${blob.path}`] = { code: text };
      })
    );
    void results; // we don't throw on individual file failures
  }

  // 7. Extract dependencies from package.json if present
  let dependencies: Record<string, string> = {};
  const pkgRaw = files["/package.json"];
  if (pkgRaw) {
    try {
      const pkg = JSON.parse(pkgRaw.code);
      dependencies = {
        ...(pkg.dependencies ?? {}),
        ...(pkg.devDependencies ?? {}),
      };
    } catch {
      // ignore parse errors
    }
  }

  return NextResponse.json({
    files,
    dependencies,
    title: repo,
    fileCount: Object.keys(files).length,
    truncated: treeData.truncated ?? false,
  });
}
