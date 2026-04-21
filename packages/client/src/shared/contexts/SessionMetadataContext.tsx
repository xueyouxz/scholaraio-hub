import { type ReactNode, createContext, useContext } from "react";

interface SessionMetadata {
  projectId: string;
  projectPath: string | null;
  sessionId: string;
}

const SessionMetadataContext = createContext<SessionMetadata | null>(null);

export function SessionMetadataProvider({
  projectId,
  projectPath,
  sessionId,
  children,
}: SessionMetadata & { children: ReactNode }) {
  return (
    <SessionMetadataContext.Provider value={{ projectId, projectPath, sessionId }}>
      {children}
    </SessionMetadataContext.Provider>
  );
}

export function useSessionMetadata(): SessionMetadata {
  const context = useContext(SessionMetadataContext);
  if (!context) {
    throw new Error("useSessionMetadata must be used within SessionMetadataProvider");
  }
  return context;
}
