import path from "path";

export function extractDependencies(files: Record<string, { code: string }>): string[] {
  const deps = new Set<string>();
  const importRegex = /(?:import|from)\s+['"]([^'"]+)['"]/g;
  const dynamicImportRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

  const extract = (match: string, p1: string) => {
    // Ignore relative and absolute paths
    if (p1.startsWith(".") || p1.startsWith("/")) return;
    
    // Ignore Node built-ins or generic non-npm things
    if (p1.startsWith("node:")) return;

    // Get the root package name
    let pkgName = p1;
    if (pkgName.startsWith("@")) {
      const parts = pkgName.split("/");
      if (parts.length >= 2) {
        pkgName = `${parts[0]}/${parts[1]}`;
      }
    } else {
      pkgName = pkgName.split("/")[0];
    }
    
    // Ignore react/react-dom since they are in base dependencies
    if (pkgName === "react" || pkgName === "react-dom") return;

    deps.add(pkgName);
  };

  for (const path in files) {
    const code = files[path].code;
    let match;
    while ((match = importRegex.exec(code)) !== null) {
      extract(match[0], match[1]);
    }
    while ((match = dynamicImportRegex.exec(code)) !== null) {
      extract(match[0], match[1]);
    }
  }

  return Array.from(deps);
}

/**
 * Automatically rewrites absolute imports (e.g. from '/pages/Dashboard')
 * into valid relative imports based on the current file path.
 */
export function autoFixAbsoluteImports(files: Record<string, { code: string }>) {
  const importRegex = /((?:import|from)\s+['"])\/([^'"]+)(['"])/g;
  const dynamicImportRegex = /(import\s*\(\s*['"])\/([^'"]+)(['"]\s*\))/g;
  
  for (const [filePath, fileData] of Object.entries(files)) {
    const dir = path.posix.dirname(filePath);
    
    const replacer = (match: string, prefix: string, importPath: string, suffix: string) => {
      let relativePath = path.posix.relative(dir, '/' + importPath);
      if (!relativePath.startsWith('.')) {
        relativePath = './' + relativePath;
      }
      return `${prefix}${relativePath}${suffix}`;
    };

    if (typeof fileData.code === 'string') {
      fileData.code = fileData.code.replace(importRegex, replacer);
      fileData.code = fileData.code.replace(dynamicImportRegex, replacer);
    }
  }
}

export interface MissingFile {
  importPath: string;
  resolvedPath: string;
  importedIn: string;
  reason: string;
}

export function findMissingFiles(files: Record<string, { code: string }>): MissingFile[] {
  const missing: MissingFile[] = [];
  const importRegex = /(?:import|from)\s+['"]([^'"]+)['"]/g;
  const dynamicImportRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

  for (const [filePath, fileData] of Object.entries(files)) {
    const code = fileData.code;
    const dir = path.posix.dirname(filePath);

    const checkImport = (importPath: string) => {
      // Only check local imports
      if (!importPath.startsWith('.') && !importPath.startsWith('/')) return;

      if (importPath.startsWith('/')) {
        missing.push({
          importPath,
          resolvedPath: importPath,
          importedIn: filePath,
          reason: 'Absolute imports are forbidden'
        });
        return;
      }

      // Resolve absolute path based on the directory
      let resolved = path.posix.resolve(dir, importPath);

      // Possible extensions Sandpack resolves automatically
      const extensions = ['', '.js', '.jsx', '.ts', '.tsx', '.css', '/index.js', '/index.jsx'];
      
      let found = false;
      for (const ext of extensions) {
        if (files[resolved + ext]) {
          found = true;
          break;
        }
      }

      if (!found) {
        missing.push({
          importPath,
          resolvedPath: resolved,
          importedIn: filePath,
          reason: 'File not found'
        });
      }
    };

    let match;
    while ((match = importRegex.exec(code)) !== null) {
      checkImport(match[1]);
    }
    while ((match = dynamicImportRegex.exec(code)) !== null) {
      checkImport(match[1]);
    }
  }

  // Deduplicate by resolvedPath
  const unique: MissingFile[] = [];
  const seen = new Set<string>();
  for (const m of missing) {
    if (!seen.has(m.resolvedPath)) {
      seen.add(m.resolvedPath);
      unique.push(m);
    }
  }

  return unique;
}

/**
 * Automatically creates dummy components/files for any missing imports
 * so that the Sandpack preview doesn't crash fatally.
 */
export function autoStubMissingFiles(files: Record<string, { code: string }>, missingFiles: MissingFile[]) {
  for (const m of missingFiles) {
    if (m.resolvedPath.endsWith('.css')) {
      files[m.resolvedPath] = { code: '/* Auto-generated missing CSS stub */' };
    } else {
      const ext = m.resolvedPath.match(/\.[a-zA-Z0-9]+$/) ? '' : '.js';
      const targetPath = m.resolvedPath + ext;
      if (!files[targetPath]) {
        files[targetPath] = {
          code: `export default function MissingComponent() { return <div style={{padding: 20, color: 'red', border: '1px solid red', borderRadius: 8, margin: 10}}><b>Missing File:</b> ${m.importPath}</div>; }`
        };
      }
    }
  }
}
