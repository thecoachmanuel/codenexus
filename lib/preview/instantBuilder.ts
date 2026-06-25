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

    const allImports = new Set<string>();
    let combinedBody = "";

    // Map to keep track of what each file exports as its default
    const defaultExportsMap: Record<string, string> = {};

    for (const file of jsFiles) {
      let code = file.code;
      const baseName = file.path.split("/").pop()?.replace(/\.jsx?$/, "") || "Component";
      const safeIdentifier = baseName.replace(/[^a-zA-Z0-9_]/g, "");

      // 1. Identify and normalize default exports
      // export default function Name() -> function Name()
      code = code.replace(/export\s+default\s+(function|class)\s+([a-zA-Z0-9_]+)/g, (match, type, name) => {
        defaultExportsMap[file.path] = name;
        return `${type} ${name}`;
      });

      // export default Identifier; -> (stripped later, but we record it)
      const idMatch = code.match(/export\s+default\s+([a-zA-Z0-9_]+);?/);
      if (idMatch && !['function', 'class', 'const', 'let', 'var'].includes(idMatch[1])) {
        defaultExportsMap[file.path] = idMatch[1];
        code = code.replace(/export\s+default\s+[a-zA-Z0-9_]+;?/g, "");
      }

      // export default () => ... -> const SafeIdentifier = () => ...
      if (!defaultExportsMap[file.path] && /export\s+default\s+/.test(code)) {
        defaultExportsMap[file.path] = safeIdentifier;
        code = code.replace(/export\s+default\s+/, `const ${safeIdentifier} = `);
      }

      // 2. Extract non-relative imports
      const importRegex = /import\s+([\s\S]*?)\s+from\s+['"]([^'".]+)['"];?/g;
      let match;
      while ((match = importRegex.exec(code)) !== null) {
        const importPath = match[2];
        if (!importPath.startsWith(".")) {
          allImports.add(match[0]);
        }
      }

      const sideEffectRegex = /import\s+['"]([^'".]+)['"];?/g;
      while ((match = sideEffectRegex.exec(code)) !== null) {
        if (!match[1].startsWith(".")) {
          allImports.add(match[0]);
        }
      }

      // 3. Process Relative Imports (Map them to our global variables)
      code = code.replace(/import\s+([a-zA-Z0-9_]+)\s+from\s+['"](\.[^'"]+)['"];?/g, (fullMatch, localName, relativePath) => {
        // Resolve the relative path to an exported name
        const targetBaseName = relativePath.split("/").pop()?.replace(/\.jsx?$/, "") || "";
        const targetSafeId = targetBaseName.replace(/[^a-zA-Z0-9_]/g, "");
        return `const ${localName} = ${targetSafeId};`;
      });

      code = code.replace(/import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];?/g, "");
      code = code.replace(/import\s+['"][^'"]+['"];?/g, "");

      // 4. Strip leftover exports
      code = code.replace(/export\s+(function|class|const|let|var)/g, "$1");
      code = code.replace(/export\s+\{[\s\S]*?\};?/g, "");

      combinedBody += `\n// --- ${file.path} ---\n` + code + "\n\n";
    }

    const finalJs = Array.from(allImports).join("\n") + "\n\n" + combinedBody;

    // 5. Build HTML
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <script>
    window.onerror = function(msg, url, lineNo, columnNo, error) {
      window.parent.postMessage({ type: 'preview_error', message: msg + '\\nLine: ' + lineNo }, '*');
      return false;
    };
    window.addEventListener('unhandledrejection', function(event) {
      window.parent.postMessage({ type: 'preview_error', message: event.reason?.message || event.reason }, '*');
    });
  </script>
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
