import { type ReactNode, createContext, useContext } from "react";
import type { ZodError } from "zod";

interface SchemaValidationContextValue {
  reportValidationError: (toolName: string, errors: ZodError) => void;
  isToolIgnored: (toolName: string) => boolean;
  ignoreToolErrors: (toolName: string) => void;
  clearIgnoredTools: () => void;
  ignoredTools: string[];
  enabled: boolean;
}

const NOOP_VALUE: SchemaValidationContextValue = {
  reportValidationError: () => {},
  isToolIgnored: () => false,
  ignoreToolErrors: () => {},
  clearIgnoredTools: () => {},
  ignoredTools: [],
  enabled: false,
};

const SchemaValidationContext = createContext<SchemaValidationContextValue>(NOOP_VALUE);

interface SchemaValidationProviderProps {
  children: ReactNode;
}

export function SchemaValidationProvider({ children }: SchemaValidationProviderProps) {
  return (
    <SchemaValidationContext.Provider value={NOOP_VALUE}>
      {children}
    </SchemaValidationContext.Provider>
  );
}

export function useSchemaValidationContext() {
  return useContext(SchemaValidationContext);
}
