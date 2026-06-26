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
      "react-dom": "https://esm.sh/react-dom@18.3.1",
      "react-dom/client": "https://esm.sh/react-dom@18.3.1/client",
      "react/jsx-runtime": "https://esm.sh/react@18.3.1/jsx-runtime",
      "react/jsx-dev-runtime": "https://esm.sh/react@18.3.1/jsx-dev-runtime",
    };

    for (const [dep, version] of Object.entries(deps)) {
      if (dep === "react" || dep === "react-dom") continue;
      const cleanVersion = (version as string).replace(/[\^~]/g, "");
      importMap[dep] = `https://esm.sh/${dep}@${cleanVersion}?external=react,react-dom`;
    }

    // 3. Gather JS/JSX files into a clean map
    const jsFilesMap: Record<string, string> = {};
    for (const [path, obj] of Object.entries(fileData.files)) {
      if (path.endsWith(".js") || path.endsWith(".jsx")) {
        // Standardize paths to ensure relative imports like './App' work.
        let cleanPath = path.replace(/^\/?(src\/)?/, "");
        if (!cleanPath.startsWith("./")) {
          cleanPath = "./" + cleanPath;
        }
        jsFilesMap[cleanPath] = obj.code || "";
      }
    }

    // 4. Build the HTML that executes the logic client-side
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
  <style>
    ${cssCode}
  </style>
</head>
<body>
  <div id="root"></div>
  <script>
    (function() {
      // Setup global error handling
      window.onerror = function(msg, url, lineNo, columnNo, error) {
        window.parent.postMessage({ type: 'preview_error', message: msg + '\\nLine: ' + lineNo }, '*');
        return false;
      };
      window.addEventListener('unhandledrejection', function(event) {
        window.parent.postMessage({ type: 'preview_error', message: event.reason?.message || event.reason }, '*');
      });

      function resolvePath(base, relative) {
        if (!relative.startsWith('.')) return relative;
        const baseParts = base.split('/');
        baseParts.pop(); // remove filename
        const relParts = relative.split('/');
        for (const part of relParts) {
          if (part === '.') continue;
          if (part === '..') baseParts.pop();
          else baseParts.push(part);
        }
        return baseParts.join('/');
      }

      const files = ${JSON.stringify(jsFilesMap)};
      const importmap = { imports: ${JSON.stringify(importMap)} };
      const blobMap = {};

      try {
        // Compile files and create Blob URLs
        for (const [path, code] of Object.entries(files)) {
          // Replace lucide-react with standard import
          let processedCode = code.replace(/import\\s+\\{([^}]+)\\}\\s+from\\s+['"]lucide-react['"]/g, "import { $1 } from 'lucide-react'");
          
          // Rewrite relative imports to bare specifiers mapped to our Blobs
          processedCode = processedCode.replace(/(import|export)\\s+([\\s\\S]*?)\\s+from\\s+['"](\\.[^'"]+)['"]/g, function(match, type, imports, relPath) {
            if (relPath.endsWith('.css')) return '';
            const resolved = resolvePath(path, relPath);
            return type + ' ' + imports + " from '__local__" + resolved + "'";
          });
          processedCode = processedCode.replace(/(import)\\s+['"](\\.[^'"]+)['"]/g, function(match, type, relPath) {
            if (relPath.endsWith('.css')) return '';
            const resolved = resolvePath(path, relPath);
            return type + " '__local__" + resolved + "'";
          });
          
          // Babel compilation
          const compiled = Babel.transform(processedCode, { presets: ['react'] }).code;
          const blob = new Blob([compiled], { type: 'application/javascript' });
          const url = URL.createObjectURL(blob);
          
          blobMap[path] = url;
        }

        // Register resolved paths in the importmap
        for (const [path, url] of Object.entries(blobMap)) {
          importmap.imports['__local__' + path] = url;
          importmap.imports['__local__' + path.replace(/\\.jsx?$/, '')] = url;
        }

        // Inject the importmap
        const script = document.createElement('script');
        script.type = 'importmap';
        script.textContent = JSON.stringify(importmap);
        document.head.appendChild(script);

        // Find the main entrypoint and bootstrap!
        const mainPath = Object.keys(files).find(p => p.includes('main.js') || p.includes('index.js'));
        if (mainPath) {
          import(blobMap[mainPath]).catch(err => {
            window.parent.postMessage({ type: 'preview_error', message: 'Bootstrap Error: ' + err.message }, '*');
          });
        } else {
          window.parent.postMessage({ type: 'preview_error', message: 'Could not find main.jsx to bootstrap' }, '*');
        }
      } catch (err) {
        window.parent.postMessage({ type: 'preview_error', message: 'Compilation Error: ' + err.message }, '*');
      }
    })();
  </script>
</body>
</html>`;
  } catch (error) {
    console.error("Instant builder failed:", error);
    return null;
  }
}
