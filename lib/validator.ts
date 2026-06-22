import * as acorn from "acorn";
import jsx from "acorn-jsx";

const parser = acorn.Parser.extend(jsx());

export type ErrorType = "syntax_error" | "import_error" | "dependency_error" | "runtime_error" | "react_hook_error" | "build_failure";

export interface ValidationResult {
  isValid: boolean;
  errorType?: ErrorType;
  message?: string;
}

export function validateAST(code: string): ValidationResult {
  try {
    parser.parse(code, {
      ecmaVersion: 2024,
      sourceType: "module",
    });
    
    // Rudimentary check for missing export default
    if (!code.includes("export default")) {
       return {
         isValid: false,
         errorType: "import_error",
         message: "Missing 'export default' in component.",
       };
    }

    return { isValid: true };
  } catch (err: any) {
    return {
      isValid: false,
      errorType: "syntax_error",
      message: err.message || "Syntax error detected in the file.",
    };
  }
}

export function classifyError(errorStr: string): ErrorType {
  const lower = errorStr.toLowerCase();
  
  if (lower.includes("syntax error") || lower.includes("unexpected token") || lower.includes("parsing error")) {
    return "syntax_error";
  }
  if (lower.includes("not defined") || lower.includes("is not defined")) {
    return "runtime_error";
  }
  if (lower.includes("module not found") || lower.includes("cannot resolve")) {
    return "dependency_error";
  }
  if (lower.includes("does not contain a default export") || lower.includes("is not exported")) {
    return "import_error";
  }
  if (lower.includes("invalid hook call") || lower.includes("rules of hooks")) {
    return "react_hook_error";
  }
  
  return "build_failure";
}
