import "./styles.css";
import type {
  AppMessage,
  AppSession,
  AppSessionSummary,
  NewSessionDefaults,
  PermissionMode,
  ProviderInfo,
} from "@scholaraio-hub/shared";

interface ProjectSummary {
  id: string;
  name?: string | null;
  path: string;
  provider: string;
  sessionCount?: number;
  activeOwnedCount?: number;
  activeExternalCount?: number;
}

interface ProcessState {
  type?: string;
}

interface ProcessSummary {
  id: string;
  sessionId: string;
  sessionTitle?: string | null;
  provider: string;
  state?: string | ProcessState | null;
  model?: string | null;
  startedAt?: string;
}

interface ServerSettings {
  globalInstructions?: string;
  newSessionDefaults?: NewSessionDefaults;
}

interface ProjectsResponse {
  projects?: ProjectSummary[];
}

interface ProvidersResponse {
  providers?: ProviderInfo[];
}

interface ProcessesResponse {
  processes?: ProcessSummary[];
  terminatedProcesses?: ProcessSummary[];
}

interface SettingsResponse {
  settings?: ServerSettings;
}

interface SessionsResponse {
  sessions?: AppSessionSummary[];
}

interface SessionDetailResponse {
  session?: AppSession | null;
}

interface State {
  projects: ProjectSummary[];
  sessions: AppSessionSummary[];
  processes: ProcessSummary[];
  providers: ProviderInfo[];
  settings: ServerSettings | null;
  selectedProjectId: string | null;
  selectedSessionId: string | null;
  selectedSession: AppSession | null;
  busy: boolean;
  error: string;
  flash: string;
}

const PERMISSION_MODES: readonly PermissionMode[] = [
  "default",
  "acceptEdits",
  "plan",
  "bypassPermissions",
];

const state: State = {
  projects: [],
  sessions: [],
  processes: [],
  providers: [],
  settings: null,
  selectedProjectId: null,
  selectedSessionId: null,
  selectedSession: null,
  busy: false,
  error: "",
  flash: "",
};

const appElement = document.querySelector<HTMLDivElement>("#app");

if (!appElement) {
  throw new Error("Expected #app container to exist");
}

const appRoot = appElement;

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDate(value: string | undefined | null): string {
  if (!value) {
    return "无";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function toText(content: AppMessage["content"] | unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((item) => {
      if (typeof item?.text === "string") {
        return item.text;
      }

      if (typeof item?.content === "string") {
        return item.content;
      }

      return typeof item?.type === "string" ? `[${item.type}]` : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function toErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function getField<T extends Element>(form: HTMLFormElement, name: string): T {
  const field = form.elements.namedItem(name);

  if (!field || field instanceof RadioNodeList) {
    throw new Error(`Missing form field: ${name}`);
  }

  return field as T;
}

function getProcessStateLabel(process: ProcessSummary): string {
  if (typeof process.state === "string") {
    return process.state;
  }

  return process.state?.type ?? "unknown";
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);

  if (!headers.has("Content-Type") && options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, {
    ...options,
    headers,
  });

  const isJson = response.headers.get("content-type")?.includes("application/json");
  const payload = isJson
    ? ((await response.json()) as unknown)
    : ((await response.text()) as unknown);

  if (!response.ok) {
    const message =
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : response.statusText;
    throw new Error(message || "Request failed");
  }

  return payload as T;
}

function setStatus(message: string, type: "success" | "error" = "error"): void {
  state.flash = type === "success" ? message : "";
  state.error = type === "error" ? message : "";
  render();
}

function findSelectedProject(): ProjectSummary | null {
  return state.projects.find((project) => project.id === state.selectedProjectId) ?? null;
}

function currentProcess(): ProcessSummary | null {
  return state.processes.find((process) => process.sessionId === state.selectedSessionId) ?? null;
}

async function loadProjects(): Promise<void> {
  const payload = await api<ProjectsResponse>("/api/projects");
  state.projects = payload.projects ?? [];

  if (!state.selectedProjectId && state.projects[0]) {
    state.selectedProjectId = state.projects[0].id;
  }
}

async function loadProviders(): Promise<void> {
  const payload = await api<ProvidersResponse>("/api/providers");
  state.providers = payload.providers ?? [];
}

async function loadProcesses(): Promise<void> {
  const payload = await api<ProcessesResponse>("/api/processes?includeTerminated=true");
  state.processes = [...(payload.processes ?? []), ...(payload.terminatedProcesses ?? [])];
}

async function loadSettings(): Promise<void> {
  const payload = await api<SettingsResponse>("/api/settings");
  state.settings = payload.settings ?? null;
}

async function loadSessions(projectId: string | null = state.selectedProjectId): Promise<void> {
  if (!projectId) {
    state.sessions = [];
    return;
  }

  const payload = await api<SessionsResponse>(`/api/projects/${projectId}/sessions`);
  state.sessions = payload.sessions ?? [];

  if (!state.sessions.some((session) => session.id === state.selectedSessionId)) {
    state.selectedSessionId = state.sessions[0]?.id ?? null;
  }
}

async function loadSessionDetail(
  projectId: string | null = state.selectedProjectId,
  sessionId: string | null = state.selectedSessionId,
): Promise<void> {
  if (!projectId || !sessionId) {
    state.selectedSession = null;
    return;
  }

  const payload = await api<SessionDetailResponse>(
    `/api/projects/${projectId}/sessions/${sessionId}`,
  );
  state.selectedSession = payload.session ?? null;
}

async function refreshAll(): Promise<void> {
  try {
    state.busy = true;
    render();

    await Promise.all([loadProjects(), loadProviders(), loadProcesses(), loadSettings()]);
    await loadSessions();
    await loadSessionDetail();

    state.error = "";
  } catch (error) {
    setStatus(toErrorMessage(error, "加载失败"));
  } finally {
    state.busy = false;
    render();
  }
}

async function handleAddProject(form: HTMLFormElement): Promise<void> {
  const pathField = getField<HTMLInputElement>(form, "path");
  const projectPath = pathField.value.trim();

  if (!projectPath) {
    return;
  }

  try {
    await api("/api/projects", {
      method: "POST",
      body: JSON.stringify({ path: projectPath }),
    });

    form.reset();
    await loadProjects();
    state.selectedProjectId =
      state.projects.find((project) => project.path === projectPath)?.id ?? state.selectedProjectId;
    await loadSessions();
    render();
    setStatus("项目已添加", "success");
  } catch (error) {
    setStatus(toErrorMessage(error, "添加项目失败"));
  }
}

async function handleStartSession(form: HTMLFormElement): Promise<void> {
  const project = findSelectedProject();

  if (!project) {
    return;
  }

  const messageField = getField<HTMLTextAreaElement>(form, "message");
  const providerField = getField<HTMLSelectElement>(form, "provider");
  const modeField = getField<HTMLSelectElement>(form, "mode");
  const modelField = getField<HTMLInputElement>(form, "model");
  const message = messageField.value.trim();

  if (!message) {
    return;
  }

  try {
    const payload = await api<{ sessionId: string }>(`/api/projects/${project.id}/sessions`, {
      method: "POST",
      body: JSON.stringify({
        message,
        provider: providerField.value || undefined,
        mode: modeField.value || undefined,
        model: modelField.value.trim() || undefined,
      }),
    });

    form.reset();
    await loadProjects();
    await loadSessions(project.id);
    state.selectedSessionId = payload.sessionId;
    await Promise.all([loadSessionDetail(project.id, payload.sessionId), loadProcesses()]);
    render();
    setStatus("会话已创建", "success");
  } catch (error) {
    setStatus(toErrorMessage(error, "创建会话失败"));
  }
}

async function handleContinueSession(form: HTMLFormElement): Promise<void> {
  const sessionId = state.selectedSessionId;

  if (!sessionId) {
    return;
  }

  const messageField = getField<HTMLTextAreaElement>(form, "message");
  const message = messageField.value.trim();

  if (!message) {
    return;
  }

  try {
    await api(`/api/sessions/${sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({ message }),
    });

    form.reset();
    await Promise.all([loadSessionDetail(), loadProcesses(), loadSessions()]);
    render();
    setStatus("消息已发送", "success");
  } catch (error) {
    setStatus(toErrorMessage(error, "发送失败"));
  }
}

async function handleSaveSessionMeta(form: HTMLFormElement): Promise<void> {
  const sessionId = state.selectedSessionId;

  if (!sessionId) {
    return;
  }

  const titleField = getField<HTMLInputElement>(form, "title");
  const archivedField = getField<HTMLInputElement>(form, "archived");
  const starredField = getField<HTMLInputElement>(form, "starred");

  try {
    await api(`/api/sessions/${sessionId}/metadata`, {
      method: "PUT",
      body: JSON.stringify({
        title: titleField.value,
        archived: archivedField.checked,
        starred: starredField.checked,
      }),
    });

    await Promise.all([loadSessions(), loadSessionDetail()]);
    render();
    setStatus("会话信息已保存", "success");
  } catch (error) {
    setStatus(toErrorMessage(error, "保存失败"));
  }
}

async function handleAbortProcess(processId: string | undefined): Promise<void> {
  if (!processId) {
    return;
  }

  try {
    await api(`/api/processes/${processId}/abort`, { method: "POST" });
    await Promise.all([loadProcesses(), loadSessions(), loadSessionDetail()]);
    render();
    setStatus("进程已中止", "success");
  } catch (error) {
    setStatus(toErrorMessage(error, "中止失败"));
  }
}

async function handleSaveSettings(form: HTMLFormElement): Promise<void> {
  const globalInstructionsField = getField<HTMLTextAreaElement>(form, "globalInstructions");
  const providerField = getField<HTMLSelectElement>(form, "provider");
  const permissionModeField = getField<HTMLSelectElement>(form, "permissionMode");
  const modelField = getField<HTMLInputElement>(form, "model");

  try {
    await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify({
        globalInstructions: globalInstructionsField.value,
        newSessionDefaults: {
          provider: providerField.value || undefined,
          model: modelField.value.trim() || undefined,
          permissionMode: permissionModeField.value || undefined,
        },
      }),
    });

    await loadSettings();
    render();
    setStatus("设置已更新", "success");
  } catch (error) {
    setStatus(toErrorMessage(error, "保存设置失败"));
  }
}

function renderProjects(): string {
  if (!state.projects.length) {
    return '<div class="empty">暂无项目</div>';
  }

  return state.projects
    .map((project) => {
      const active = state.selectedProjectId === project.id ? "active" : "";
      const runningCount = (project.activeOwnedCount ?? 0) + (project.activeExternalCount ?? 0);

      return `
        <button class="card ${active}" data-action="select-project" data-project-id="${escapeHtml(project.id)}">
          <h3 class="card-title">${escapeHtml(project.name || project.path)}</h3>
          <div class="card-meta">
            <span>${escapeHtml(project.provider)}</span>
            <span>${project.sessionCount ?? 0} sessions</span>
            <span>${runningCount} active</span>
          </div>
          <div class="muted">${escapeHtml(project.path)}</div>
        </button>
      `;
    })
    .join("");
}

function renderSessions(): string {
  if (!state.selectedProjectId) {
    return '<div class="empty">先选择项目</div>';
  }

  if (!state.sessions.length) {
    return '<div class="empty">该项目还没有会话</div>';
  }

  return state.sessions
    .map((session) => {
      const active = state.selectedSessionId === session.id ? "active" : "";
      const badges: string[] = [];

      if (session.ownership.owner === "self") {
        badges.push('<span class="badge running">running</span>');
      }

      if (session.pendingInputType) {
        badges.push(`<span class="badge waiting">${escapeHtml(session.pendingInputType)}</span>`);
      }

      if (session.hasUnread) {
        badges.push('<span class="badge unread">unread</span>');
      }

      if (session.isStarred) {
        badges.push('<span class="badge">starred</span>');
      }

      return `
        <button class="card ${active}" data-action="select-session" data-session-id="${escapeHtml(session.id)}">
          <h3 class="card-title">${escapeHtml(session.customTitle || session.title || "Untitled")}</h3>
          <div class="pillbar">${badges.join("")}</div>
          <div class="card-meta">
            <span>${escapeHtml(session.provider || "-")}</span>
            <span>${session.messageCount ?? 0} msgs</span>
          </div>
          <div class="muted">${escapeHtml(formatDate(session.updatedAt))}</div>
        </button>
      `;
    })
    .join("");
}

function renderMessages(): string {
  const session = state.selectedSession;
  const messages = session?.messages ?? [];

  if (!messages.length) {
    return '<div class="empty">选中会话后会在这里展示消息历史。</div>';
  }

  return messages
    .map((message) => {
      const role = escapeHtml(message.role || message.type || "message");

      return `
        <article class="message ${role}">
          <div class="inline-meta">
            <strong>${role}</strong>
            <span>${escapeHtml(formatDate(message.timestamp as string | undefined))}</span>
          </div>
          <pre>${escapeHtml(toText(message.content))}</pre>
        </article>
      `;
    })
    .join("");
}

function renderProcesses(): string {
  if (!state.processes.length) {
    return '<div class="empty">当前没有活动或最近终止的进程。</div>';
  }

  return state.processes
    .map((process) => {
      const sessionMatch = process.sessionId === state.selectedSessionId;

      return `
        <div class="card ${sessionMatch ? "active" : ""}">
          <h3 class="card-title">${escapeHtml(process.sessionTitle || process.sessionId)}</h3>
          <div class="card-meta">
            <span>${escapeHtml(process.provider)}</span>
            <span>${escapeHtml(getProcessStateLabel(process))}</span>
            <span>${escapeHtml(process.model || "-")}</span>
          </div>
          <div class="inline-meta">
            <span>${escapeHtml(process.id)}</span>
            <span>${escapeHtml(formatDate(process.startedAt))}</span>
          </div>
          <div class="footer-actions">
            <button class="ghost" data-action="abort-process" data-process-id="${escapeHtml(process.id)}">Abort</button>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderApp(): void {
  const project = findSelectedProject();
  const session = state.selectedSession;
  const process = currentProcess();
  const defaults = state.settings?.newSessionDefaults ?? {};
  const providerOptions = [
    '<option value="">默认</option>',
    ...state.providers.map(
      (provider) =>
        `<option value="${escapeHtml(provider.name)}">${escapeHtml(provider.displayName)}</option>`,
    ),
  ].join("");

  appRoot.innerHTML = `
    <main class="shell">
      <section class="panel">
        <div class="panel-header">
          <p class="title">Projects</p>
          <div class="toolbar">
            <button class="primary" data-action="refresh">刷新</button>
          </div>
        </div>
        <div class="panel-body stack">
          <form id="add-project-form" class="stack">
            <input name="path" placeholder="绝对路径，例如 /Users/name/repo" />
            <button type="submit">添加项目</button>
          </form>
          <div class="list">${renderProjects()}</div>
        </div>
      </section>

      <section class="panel">
        <div class="hero">
          <h1>极简会话台</h1>
          <p>基于现有 server API 的轻量前端，覆盖项目、会话、设置和运行进程。</p>
        </div>
        <div class="panel-body stack">
          <div class="toolbar">
            <span class="badge">${state.busy ? "loading" : "ready"}</span>
            <span class="badge">${escapeHtml(__APP_VERSION__)}</span>
            ${project ? `<span class="badge">${escapeHtml(project.name || project.path)}</span>` : ""}
            ${session ? `<span class="badge">${escapeHtml(session.provider || "-")}</span>` : ""}
            ${process ? `<span class="badge running">${escapeHtml(getProcessStateLabel(process))}</span>` : ""}
          </div>
          ${state.error ? `<div class="error">${escapeHtml(state.error)}</div>` : ""}
          ${state.flash ? `<div class="success">${escapeHtml(state.flash)}</div>` : ""}

          <form id="start-session-form" class="stack">
            <textarea name="message" placeholder="在当前项目中启动新会话"></textarea>
            <div class="grid-two">
              <select name="provider">${providerOptions}</select>
              <select name="mode">
                <option value="">默认权限</option>
                ${PERMISSION_MODES.map((mode) => `<option value="${mode}">${mode}</option>`).join(
                  "",
                )}
              </select>
            </div>
            <input name="model" placeholder="可选模型 ID" />
            <button type="submit" class="primary" ${project ? "" : "disabled"}>创建会话</button>
          </form>

          <div>
            <p class="title">Sessions</p>
            <div class="list">${renderSessions()}</div>
          </div>
        </div>
      </section>

      <section class="stack">
        <section class="panel">
          <div class="panel-header">
            <p class="title">Session Detail</p>
          </div>
          <div class="panel-body stack">
            ${
              session
                ? `
                  <div class="stack">
                    <h2 class="card-title">${escapeHtml(session.customTitle || session.title || "Untitled")}</h2>
                    <div class="card-meta">
                      <span>${escapeHtml(session.id)}</span>
                      <span>${escapeHtml(session.model || "default model")}</span>
                      <span>${escapeHtml(formatDate(session.updatedAt))}</span>
                    </div>
                  </div>
                  <form id="session-meta-form" class="stack">
                    <input name="title" placeholder="自定义标题" value="${escapeHtml(session.customTitle || "")}" />
                    <div class="toolbar">
                      <label><input type="checkbox" name="starred" ${session.isStarred ? "checked" : ""} /> Star</label>
                      <label><input type="checkbox" name="archived" ${session.isArchived ? "checked" : ""} /> Archive</label>
                    </div>
                    <button type="submit">保存会话信息</button>
                  </form>
                  <div class="conversation">${renderMessages()}</div>
                  <form id="continue-session-form" class="stack">
                    <textarea name="message" placeholder="继续当前会话"></textarea>
                    <button type="submit" class="primary">发送消息</button>
                  </form>
                `
                : '<div class="empty">选择一个会话查看详情。</div>'
            }
          </div>
        </section>

        <section class="panel">
          <div class="panel-header">
            <p class="title">Server State</p>
          </div>
          <div class="panel-body stack">
            <form id="settings-form" class="stack">
              <textarea name="globalInstructions" placeholder="全局系统提示">${escapeHtml(state.settings?.globalInstructions || "")}</textarea>
              <div class="grid-two">
                <select name="provider">
                  <option value="">默认 provider</option>
                  <option value="claude" ${defaults.provider === "claude" ? "selected" : ""}>claude</option>
                  <option value="codex" ${defaults.provider === "codex" ? "selected" : ""}>codex</option>
                </select>
                <select name="permissionMode">
                  <option value="">默认权限模式</option>
                  ${PERMISSION_MODES.map(
                    (mode) =>
                      `<option value="${mode}" ${defaults.permissionMode === mode ? "selected" : ""}>${mode}</option>`,
                  ).join("")}
                </select>
              </div>
              <input name="model" placeholder="默认模型" value="${escapeHtml(defaults.model || "")}" />
              <button type="submit">保存设置</button>
            </form>
            <div>
              <p class="title">Processes</p>
              <div class="stack">${renderProcesses()}</div>
            </div>
          </div>
        </section>
      </section>
    </main>
  `;

  bindEvents();
}

function bindEvents(): void {
  document
    .querySelector<HTMLButtonElement>('[data-action="refresh"]')
    ?.addEventListener("click", () => {
      void refreshAll();
    });

  for (const button of document.querySelectorAll<HTMLButtonElement>(
    '[data-action="select-project"]',
  )) {
    button.addEventListener("click", () => {
      void (async () => {
        state.selectedProjectId = button.dataset.projectId ?? null;
        state.selectedSessionId = null;
        state.selectedSession = null;
        state.flash = "";
        await loadSessions();
        await loadSessionDetail();
        render();
      })();
    });
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>(
    '[data-action="select-session"]',
  )) {
    button.addEventListener("click", () => {
      void (async () => {
        state.selectedSessionId = button.dataset.sessionId ?? null;
        state.flash = "";
        await Promise.all([loadSessionDetail(), loadProcesses()]);
        render();
      })();
    });
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>(
    '[data-action="abort-process"]',
  )) {
    button.addEventListener("click", () => {
      void handleAbortProcess(button.dataset.processId);
    });
  }

  document
    .querySelector<HTMLFormElement>("#add-project-form")
    ?.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      if (form instanceof HTMLFormElement) {
        void handleAddProject(form);
      }
    });

  document
    .querySelector<HTMLFormElement>("#start-session-form")
    ?.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      if (form instanceof HTMLFormElement) {
        void handleStartSession(form);
      }
    });

  document
    .querySelector<HTMLFormElement>("#continue-session-form")
    ?.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      if (form instanceof HTMLFormElement) {
        void handleContinueSession(form);
      }
    });

  document
    .querySelector<HTMLFormElement>("#session-meta-form")
    ?.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      if (form instanceof HTMLFormElement) {
        void handleSaveSessionMeta(form);
      }
    });

  document.querySelector<HTMLFormElement>("#settings-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (form instanceof HTMLFormElement) {
      void handleSaveSettings(form);
    }
  });
}

function render(): void {
  renderApp();
}

void refreshAll();
window.setInterval(() => {
  void refreshAll();
}, 15000);
