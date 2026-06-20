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
