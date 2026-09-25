import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { sessionQuery } from "../../core/sessions";
import { NewSessionView } from "../../features/session/NewSessionView";
import { SessionChatView } from "../../features/session/SessionChatView";

/** `/sessions` starts a new chat; `/sessions/:sessionId` opens an existing one. */
export function SessionPage() {
  const { sessionId } = useParams();
  const session = useQuery({ ...sessionQuery(sessionId ?? ""), enabled: !!sessionId });
  if (!sessionId) return <NewSessionView />;
  if (session.error)
    return (
      <p role="alert" className="p-6 text-error">
        {session.error.message}
      </p>
    );
  if (!session.data) return <output className="p-6">正在加载会话…</output>;
  return <SessionChatView key={sessionId} initial={session.data} />;
}
