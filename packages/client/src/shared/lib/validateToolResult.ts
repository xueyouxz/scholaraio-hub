import type { ZodError } from "zod";

export interface ValidationResult {
  valid: boolean;
  errors?: ZodError;
  toolName: string;
}

export function validateToolResult(toolName: string, _result: unknown): ValidationResult {
  return { valid: true, toolName };
}
