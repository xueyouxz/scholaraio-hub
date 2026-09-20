import { useChat } from "@ai-sdk/react";
import type { InputRequest, SessionMessage, StoredSession } from "@scholaraio-hub/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DefaultChatTransport } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { requestJson } from "../../core/http";
import { libraryApi, sessionApi } from "../../core/library";
import { SessionMessages } from "../../features/session/components/SessionMessages";

export function SessionPage() {
  const { sessionId } = useParams();
  const session = useQuery({
    queryKey: ["session", sessionId],
    queryFn: ({ signal }) => sessionApi.get(sessionId ?? "", signal),
    enabled: !!sessionId,
  });
  if (!sessionId) return <NewSession />;
  if (session.error)
    return (
      <p role="alert" className="p-6 text-error">
        {session.error.message}
      </p>
    );
  if (!session.data) return <output className="p-6">正在加载会话…</output>;
  return <SessionChat key={sessionId} initial={session.data} />;
}

function NewSession() {
  const [params] = useSearchParams();
  const paperIds = (params.get("papers") ?? "").split(",").filter(Boolean);
  const [provider, setProvider] = useState<"claude" | "codex">("claude");
  const [model, setModel] = useState("");
  const client = useQueryClient();
  const navigate = useNavigate();
  const papers = useQuery({
    queryKey: ["library", "papers"],
    queryFn: ({ signal }) => libraryApi.papers(signal),
    enabled: paperIds.length > 0,
  });
  const create = useMutation({
    mutationFn: () => sessionApi.create(provider, paperIds, model || undefined),
    onSuccess: (session) => {
      void client.invalidateQueries({ queryKey: ["sessions"] });
      navigate(`/sessions/${session.id}`);
    },
  });
  const history = useMutation({
    mutationFn: async (file: File) =>
      requestJson<StoredSession>("/api/sessions/import", {
        method: "POST",
        body: JSON.stringify({ provider, title: file.name, content: await file.text() }),
      }),
    onSuccess: (session) => {
      void client.invalidateQueries({ queryKey: ["sessions"] });
      navigate(`/sessions/${session.id}`);
    },
  });
  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="w-full max-w-xl space-y-6">
        <h1 className="text-3xl text-primary">与文献对话</h1>
        <p className="text-on-surface-variant">
          {paperIds.length
            ? `围绕选中的 ${paperIds.length} 篇文献提问。`
            : "检索本地文献，为回答提供可查看的原文依据。"}
        </p>
        {paperIds.length ? (
          <ul className="text-sm space-y-2">
            {papers.data?.papers
              .filter((paper) => paperIds.includes(paper.id))
              .map((paper) => (
                <li key={paper.id}>
                  <Link className="text-primary hover:underline" to={`/library/${paper.id}`}>
                    {paper.title}
                  </Link>
                </li>
              ))}
          </ul>
        ) : null}
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <label className="block text-sm">
            AI 工具
            <select
              className="hub-input block w-full mt-2"
              value={provider}
              onChange={(event) => setProvider(event.target.value as "claude" | "codex")}
            >
              <option value="claude">Claude Code</option>
              <option value="codex">Codex</option>
            </select>
          </label>
          <label className="block text-sm">
            模型（可选）
            <input
              className="hub-input block w-full mt-2"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder="使用 CLI 默认模型…"
            />
          </label>
          <button
            className="hub-button signature-gradient text-white"
            disabled={create.isPending}
            type="submit"
          >
            {create.isPending ? "创建中…" : "开始对话"}
          </button>
        </form>
        {(create.error ?? history.error) ? (
          <p role="alert" className="text-error">
            {(create.error ?? history.error)?.message}
          </p>
        ) : null}
        <details className="text-sm text-on-surface-variant">
          <summary className="cursor-pointer">导入已有 CLI 历史</summary>
          <p className="my-2">
            选择上方对应的 AI 工具后导入 JSONL 文件。导入记录只读，不连接外部会话。
          </p>
          <label>
            选择历史文件
            <input
              className="block mt-2"
              type="file"
              accept=".jsonl"
              disabled={history.isPending}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) history.mutate(file);
                event.target.value = "";
              }}
            />
          </label>
        </details>
      </div>
    </div>
  );
}

function SessionChat({ initial }: { initial: StoredSession }) {
  const client = useQueryClient();
  const [text, setText] = useState("");
  const viewport = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const refresh = useCallback(() => {
    void client.invalidateQueries({ queryKey: ["session", initial.id] });
    void client.invalidateQueries({ queryKey: ["sessions"] });
  }, [client, initial.id]);
  const transport = useMemo(
    () =>
      new DefaultChatTransport<SessionMessage>({
        api: `/api/sessions/${initial.id}/messages`,
        headers: { "ScholarAIO-Hub": "true" },
        prepareSendMessagesRequest: ({ messages }) => {
          const message = messages.at(-1);
          return {
            body: {
              id: message?.id,
              text: message?.parts
                .filter((part) => part.type === "text")
                .map((part) => part.text)
                .join("\n"),
            },
          };
        },
        prepareReconnectToStreamRequest: () => ({ api: `/api/sessions/${initial.id}/stream` }),
      }),
    [initial.id],
  );
  const chat = useChat<SessionMessage>({
    id: initial.id,
    messages: initial.messages,
    transport,
    resume: initial.state === "running" || initial.state === "waiting-input",
    onFinish: refresh,
    onError: refresh,
    throttle: 50,
  });
  const busy = chat.status === "submitted" || chat.status === "streaming";
  const state = useQuery({
    queryKey: ["session", initial.id],
    queryFn: ({ signal }) => sessionApi.get(initial.id, signal),
    refetchInterval: (query) =>
      busy || ["running", "waiting-input"].includes(query.state.data?.state ?? "") ? 1000 : false,
  });
  const stop = useMutation({ mutationFn: () => sessionApi.stop(initial.id), onSuccess: refresh });
  const reconnect = useMutation({
    mutationFn: async () => {
      const current = await sessionApi.get(initial.id);
      chat.setMessages(current.messages);
      chat.clearError();
      if (["running", "waiting-input"].includes(current.state)) await chat.resumeStream();
      refresh();
    },
  });
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const onScroll = () => {
      follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 120;
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => element.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    if (chat.messages.length && follow.current)
      viewport.current?.scrollTo({ top: viewport.current.scrollHeight });
  }, [chat.messages]);
  const pending = state.data?.pendingInput;
  const running = busy || ["running", "waiting-input"].includes(state.data?.state ?? "");
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <header className="flex gap-3 items-center p-4 border-b border-outline-variant/15">
        <h1 className="font-serif text-lg truncate flex-1">{state.data?.title ?? initial.title}</h1>
        <span className="text-xs text-on-surface-variant">
          {initial.provider} ·{" "}
          {initial.paperIds.length ? `${initial.paperIds.length} 篇文献` : "全库"}
        </span>
        <Link className="hub-button" to={`/sessions?papers=${initial.paperIds.join(",")}`}>
          新对话
        </Link>
      </header>
      <div ref={viewport} className="flex-1 min-h-0 overflow-auto px-5">
        <div className="max-w-4xl mx-auto pb-8">
          <SessionMessages messages={chat.messages} streaming={busy} />
          {chat.messages.length === 0 ? (
            <p className="py-12 text-center text-on-surface-variant">输入问题，开始阅读和讨论。</p>
          ) : null}
          {busy ? (
            <output className="text-xs text-on-surface-variant">
              {pending ? "等待你的回复…" : "正在生成…"}
            </output>
          ) : null}
        </div>
      </div>
      <div className="px-5 py-4 border-t border-outline-variant/15">
        <div className="max-w-4xl mx-auto space-y-3">
          {pending ? (
            <InputRequestForm
              key={pending.id}
              request={pending}
              sessionId={initial.id}
              onDone={refresh}
            />
          ) : null}
          {(chat.error ?? stop.error ?? reconnect.error) ? (
            <div role="alert" className="text-error text-sm">
              {(chat.error ?? stop.error ?? reconnect.error)?.message}
              <button
                type="button"
                className="hub-button ml-2"
                disabled={reconnect.isPending}
                onClick={() => reconnect.mutate()}
              >
                重新连接
              </button>
            </div>
          ) : null}
          {state.data?.error && !busy ? (
            <p className="text-sm text-on-surface-variant">{state.data.error}</p>
          ) : null}
          {initial.readOnly ? (
            <p className="text-sm text-on-surface-variant">
              这是导入的只读历史。新建会话后可继续提问。
            </p>
          ) : (
            <form
              className="flex gap-3 items-end"
              onSubmit={(event) => {
                event.preventDefault();
                if (!text.trim() || running) return;
                void chat.sendMessage({ text });
                setText("");
                follow.current = true;
              }}
            >
              <label className="sr-only" htmlFor="session-input">
                输入问题
              </label>
              <textarea
                id="session-input"
                className="hub-input flex-1 resize-y max-h-52"
                rows={2}
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="输入问题…"
              />
              {running ? (
                <button
                  className="hub-button"
                  type="button"
                  disabled={stop.isPending}
                  onClick={() => stop.mutate()}
                >
                  停止
                </button>
              ) : (
                <button
                  className="hub-button signature-gradient text-white"
                  type="submit"
                  disabled={!text.trim()}
                >
                  发送
                </button>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function InputRequestForm({
  request,
  sessionId,
  onDone,
}: { request: InputRequest; sessionId: string; onDone: () => void }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const mutation = useMutation({
    mutationFn: (decision: "approve" | "deny") =>
      sessionApi.input(sessionId, request.id, decision, answers),
    onSuccess: onDone,
  });
  const data =
    request.toolInput && typeof request.toolInput === "object"
      ? (request.toolInput as Record<string, unknown>)
      : {};
  const questions = Array.isArray(data.questions)
    ? (data.questions as {
        question: string;
        options?: { label: string; description?: string }[];
      }[])
    : [];
  return (
    <section className="rounded-xl bg-secondary-container/40 p-4 space-y-3" aria-label="等待输入">
      <p className="text-sm font-semibold">{request.prompt || request.toolName}</p>
      {questions.length ? (
        questions.map((question) => (
          <label key={question.question} className="block text-sm">
            {question.question}
            <input
              className="hub-input block w-full mt-1"
              list={`options-${request.id}-${questions.indexOf(question)}`}
              value={answers[question.question] ?? ""}
              onChange={(event) =>
                setAnswers((previous) => ({ ...previous, [question.question]: event.target.value }))
              }
            />
            <datalist id={`options-${request.id}-${questions.indexOf(question)}`}>
              {question.options?.map((option) => (
                <option key={option.label} value={option.label}>
                  {option.description}
                </option>
              ))}
            </datalist>
          </label>
        ))
      ) : (
        <pre className="text-xs max-h-40 overflow-auto whitespace-pre-wrap break-all">
          {JSON.stringify(request.toolInput, null, 2)}
        </pre>
      )}
      <div className="flex gap-2">
        <button
          className="hub-button"
          type="button"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate("approve")}
        >
          {questions.length ? "提交回答" : "允许"}
        </button>
        <button
          className="hub-button"
          type="button"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate("deny")}
        >
          拒绝
        </button>
      </div>
      {mutation.error ? (
        <p role="alert" className="text-error text-sm">
          {mutation.error.message}
        </p>
      ) : null}
    </section>
  );
}
