import { FileData } from "@/types/workspace";

export function buildInstantPreviewHTML(fileData: FileData): string | null {
  if (!fileData || !fileData.files) return null;

  try {
    // 1. Get CSS
    const cssCode =
      fileData.files["/src/index.css"]?.code ||
      fileData.files["src/index.css"]?.code ||
      "";

    // 2. Get Package JSON for imports
    let pkg: Record<string, any> = {};
    const pkgRaw =
      fileData.files["/package.json"]?.code ||
      fileData.files["package.json"]?.code;
    if (pkgRaw) {
      try {
        pkg = JSON.parse(pkgRaw);
      } catch {
        // Ignore parse error
      }
    }

    const deps = pkg.dependencies || {};
    const importMap: Record<string, string> = {
      react: "https://esm.sh/react@18.3.1",
      "react-dom/client": "https://esm.sh/react-dom@18.3.1/client",
    };

    for (const [dep, version] of Object.entries(deps)) {
      if (dep === "react" || dep === "react-dom") continue;
      const cleanVersion = (version as string).replace(/[\^~]/g, "");
      importMap[dep] = `https://esm.sh/${dep}@${cleanVersion}?external=react,react-dom`;
    }

    // 3. Gather and sort JS/JSX files
    const jsFiles = Object.entries(fileData.files)
      .filter(([path]) => path.endsWith(".js") || path.endsWith(".jsx"))
      .map(([path, obj]) => ({ path, code: obj.code || "" }));

    // Sort order: components first, then App.jsx, then main.jsx last
    jsFiles.sort((a, b) => {
      const aLower = a.path.toLowerCase();
      const bLower = b.path.toLowerCase();
      if (aLower.includes("main.jsx")) return 1;
      if (bLower.includes("main.jsx")) return -1;
      if (aLower.includes("app.jsx")) return 1;
      if (bLower.includes("app.jsx")) return -1;
      return 0;
    });

    // 4. Combine JS
    const allImports = new Set<string>();
    let combinedBody = "";

    for (const file of jsFiles) {
      let code = file.code;

      // Extract non-relative imports
      const importRegex = /import\s+(?:.*?\s+from\s+)?['"]([^'".]+)['"];?/g;
      let match;
      while ((match = importRegex.exec(code)) !== null) {
        const importPath = match[1];
        if (!importPath.startsWith(".")) {
          allImports.add(match[0]);
        }
      }

      // Strip ALL imports
      code = code.replace(/import\s+(?:.*?\s+from\s+)?['"][^'"]+['"];?/g, "");

      // Strip export default (convert to just function/class declaration)
      code = code.replace(/export\s+default\s+(function|class|const|let|var)/g, "$1");
      
      // Strip other exports
      code = code.replace(/export\s+(function|class|const|let|var)/g, "$1");

      combinedBody += `\n// --- ${file.path} ---\n` + code + "\n\n";
    }

    const finalJs = Array.from(allImports).join("\n") + "\n\n" + combinedBody;

    // 5. Build HTML
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <script type="importmap">
  { "imports": ${JSON.stringify(importMap, null, 2)} }
  </script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
  <style>
    ${cssCode}
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel" data-type="module">
${finalJs}
  </script>
</body>
</html>`;
  } catch (error) {
    console.error("Instant builder failed:", error);
    return null;
  }
}
