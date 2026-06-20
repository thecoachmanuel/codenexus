export function parseXmlTools(rawText: string) {
  const tools: { name: string; attributes: Record<string, string>; content: string }[] = [];
  
  // A regex to match <tag attr="value">content</tag>
  const tagRegex = /<([a-zA-Z0-9_]+)([^>]*)>([\s\S]*?)<\/\1>/g;
  let match;
  
  while ((match = tagRegex.exec(rawText)) !== null) {
    const name = match[1];
    const attrString = match[2];
    const content = match[3].trim();
    
    const attributes: Record<string, string> = {};
    const attrRegex = /([a-zA-Z0-9_]+)=["']([^"']*)["']/g;
    let attrMatch;
    while ((attrMatch = attrRegex.exec(attrString)) !== null) {
      attributes[attrMatch[1]] = attrMatch[2];
    }
    
    tools.push({ name, attributes, content });
  }
  
  // Also support self-closing tags like <verify /> or <finish title="App" />
  const selfClosingRegex = /<([a-zA-Z0-9_]+)([^>]*)\/>/g;
  while ((match = selfClosingRegex.exec(rawText)) !== null) {
    const name = match[1];
    const attrString = match[2];
    
    const attributes: Record<string, string> = {};
    const attrRegex = /([a-zA-Z0-9_]+)=["']([^"']*)["']/g;
    let attrMatch;
    while ((attrMatch = attrRegex.exec(attrString)) !== null) {
      attributes[attrMatch[1]] = attrMatch[2];
    }
    
    tools.push({ name, attributes, content: "" });
  }

  return tools;
}
