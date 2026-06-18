import { WebContainer } from "@webcontainer/api";
import type { FullstackFileData } from "@/types/fullstack";

let webcontainerInstance: WebContainer | null = null;

export async function getWebContainer(): Promise<WebContainer> {
  if (!webcontainerInstance) {
    webcontainerInstance = await WebContainer.boot();
  }
  return webcontainerInstance;
}

export async function mountFiles(
  container: WebContainer,
  fileData: FullstackFileData
) {
  // Convert our flat Record<string, string> into WebContainer's FileSystemTree
  const tree: Record<string, any> = {};

  for (const [path, content] of Object.entries(fileData.files)) {
    // path might be "app/page.tsx" or "/app/page.tsx"
    const parts = path.replace(/^\//, "").split("/");
    const filename = parts.pop()!;

    let current = tree;
    for (const dir of parts) {
      if (!current[dir]) {
        current[dir] = { directory: {} };
      }
      current = current[dir].directory;
    }

    current[filename] = {
      file: {
        contents: content,
      },
    };
  }

  // Also mount package.json
  tree["package.json"] = {
    file: {
      contents: JSON.stringify(
        {
          name: fileData.appName || "ai-generated-app",
          private: true,
          type: "module",
          scripts: {
            dev: fileData.startCommand ?? "next dev",
            build: "next build",
            start: "next start",
          },
          dependencies: fileData.dependencies,
          devDependencies: fileData.devDependencies,
        },
        null,
        2
      ),
    },
  };

  await container.mount(tree);
}

export async function installDependencies(
  container: WebContainer,
  onOutput: (data: string) => void
): Promise<number> {
  const installProcess = await container.spawn("npm", ["install"]);
  installProcess.output.pipeTo(
    new WritableStream({
      write(data) {
        onOutput(data);
      },
    })
  );
  return installProcess.exit;
}

export async function startDevServer(
  container: WebContainer,
  onOutput: (data: string) => void,
  onServerReady: (url: string) => void
) {
  const startProcess = await container.spawn("npm", ["run", "dev"]);
  startProcess.output.pipeTo(
    new WritableStream({
      write(data) {
        onOutput(data);
      },
    })
  );

  container.on("server-ready", (port, url) => {
    onServerReady(url);
  });

  return startProcess;
}

export async function teardownWebContainer() {
  if (webcontainerInstance) {
    webcontainerInstance.teardown();
    webcontainerInstance = null;
  }
}
