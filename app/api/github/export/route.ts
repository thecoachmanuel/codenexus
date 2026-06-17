import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import User from "@/lib/models/User";

interface ExportBody {
  repoName: string;
  description?: string;
  isPrivate: boolean;
  files: Record<string, { code: string }>;
  appTitle?: string;
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  await connectDB();
  const user = await User.findById(session.userId).select("githubToken plan");

  if (!user?.githubToken) {
    return NextResponse.json(
      { message: "Connect your GitHub account first." },
      { status: 400 }
    );
  }

  const { repoName, description, isPrivate, files, appTitle } = await req.json() as ExportBody;

  if (!repoName?.trim()) {
    return NextResponse.json({ message: "Repository name is required." }, { status: 400 });
  }

  // Sanitize repo name: lowercase, replace spaces/special chars with hyphens
  const sanitizedName = repoName.trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_.]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  const token = user.githubToken;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  // 1. Get authenticated user's login
  const meRes = await fetch("https://api.github.com/user", { headers });
  if (!meRes.ok) {
    return NextResponse.json({ message: "GitHub token is invalid or expired." }, { status: 401 });
  }
  const { login } = await meRes.json() as { login: string };

  // 2. Create the repository
  const createRes = await fetch("https://api.github.com/user/repos", {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: sanitizedName,
      description: description || `Generated with Crevo AI — ${appTitle || "App"}`,
      private: isPrivate,
      auto_init: false,
    }),
  });

  if (!createRes.ok) {
    const err = await createRes.json() as { message?: string; errors?: { message: string }[] };
    const detail = err.errors?.[0]?.message ?? err.message ?? "Failed to create repository.";
    // Common: repo already exists
    if (detail.includes("already exists") || createRes.status === 422) {
      return NextResponse.json(
        { message: `Repository "${sanitizedName}" already exists in your GitHub account.` },
        { status: 422 }
      );
    }
    return NextResponse.json({ message: detail }, { status: createRes.status });
  }

  const repo = await createRes.json() as { html_url: string; default_branch: string };

  // 3. Prepare files for GitHub tree API
  const fileEntries = Object.entries(files);

  if (fileEntries.length === 0) {
    return NextResponse.json({ message: "No files to export." }, { status: 400 });
  }

  // Add a README
  const readmeContent = `# ${appTitle || sanitizedName}

Generated with [Crevo](https://crevo.app) — AI-powered app builder.

## Getting started

\`\`\`bash
npm install
npm start
\`\`\`
`;

  // 4. Create blobs for all files
  const treeItems: { path: string; mode: string; type: string; sha: string }[] = [];

  const BATCH_SIZE = 10;
  const allFiles: [string, string][] = [
    ["README.md", readmeContent],
    ...fileEntries.map(([path, { code }]): [string, string] => [
      path.startsWith("/") ? path.slice(1) : path,
      code,
    ]),
  ];

  for (let i = 0; i < allFiles.length; i += BATCH_SIZE) {
    const batch = allFiles.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async ([filePath, content]) => {
        const blobRes = await fetch(
          `https://api.github.com/repos/${login}/${sanitizedName}/git/blobs`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({ content, encoding: "utf-8" }),
          }
        );
        if (!blobRes.ok) throw new Error(`Failed to create blob for ${filePath}`);
        const blob = await blobRes.json() as { sha: string };
        return { path: filePath, mode: "100644", type: "blob", sha: blob.sha };
      })
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        treeItems.push(result.value);
      }
    }
  }

  // 5. Create a git tree
  const treeRes = await fetch(
    `https://api.github.com/repos/${login}/${sanitizedName}/git/trees`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ tree: treeItems }),
    }
  );

  if (!treeRes.ok) {
    return NextResponse.json({ message: "Failed to create git tree." }, { status: 502 });
  }
  const tree = await treeRes.json() as { sha: string };

  // 6. Create a commit
  const commitRes = await fetch(
    `https://api.github.com/repos/${login}/${sanitizedName}/git/commits`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        message: `feat: initial commit from Crevo AI\n\nGenerated with Crevo — https://crevo.app`,
        tree: tree.sha,
        parents: [],
      }),
    }
  );

  if (!commitRes.ok) {
    return NextResponse.json({ message: "Failed to create commit." }, { status: 502 });
  }
  const commit = await commitRes.json() as { sha: string };

  // 7. Update the default branch ref (or create it)
  const refRes = await fetch(
    `https://api.github.com/repos/${login}/${sanitizedName}/git/refs`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        ref: "refs/heads/main",
        sha: commit.sha,
      }),
    }
  );

  if (!refRes.ok) {
    // Try PATCH if ref already exists
    await fetch(
      `https://api.github.com/repos/${login}/${sanitizedName}/git/refs/heads/main`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({ sha: commit.sha, force: true }),
      }
    );
  }

  return NextResponse.json({
    url: repo.html_url,
    repoName: sanitizedName,
    fileCount: treeItems.length,
  });
}
