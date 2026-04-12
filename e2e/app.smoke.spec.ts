import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  const state = {
    projects: [
      {
        id: "proj-1",
        name: "Alpha Project",
        path: "/workspace/alpha",
        provider: "claude",
        sessionCount: 2,
        activeOwnedCount: 1,
        activeExternalCount: 0,
        lastActivity: "2026-04-12T10:00:00.000Z",
      },
    ],
    sessions: [
      {
        id: "sess-existing",
        projectId: "proj-1",
        provider: "claude-ollama",
        title: "Existing session",
        customTitle: "Historical provider session",
        updatedAt: "2026-04-12T10:05:00.000Z",
        messageCount: 3,
      },
    ],
    sessionDetail: {
      session: {
        id: "sess-existing",
        projectId: "proj-1",
        title: "Existing session",
        customTitle: "Historical provider session",
        provider: "claude-ollama",
        model: "claude-sonnet",
        ownership: { owner: "self" },
      },
      messages: [
        {
          id: "msg-user-1",
          type: "user",
          timestamp: "2026-04-12T10:01:00.000Z",
          content: "Summarize the repo state.",
        },
        {
          id: "msg-assistant-1",
          type: "assistant",
          timestamp: "2026-04-12T10:02:00.000Z",
          content: [{ type: "text", text: "Repo state summary here." }],
        },
      ],
      ownership: { owner: "self" },
      pendingInputRequest: {
        id: "input-1",
        type: "tool_approval",
        toolName: "edit_file",
      },
      pagination: {
        hasOlderMessages: true,
        totalMessageCount: 6,
        returnedMessageCount: 2,
        truncatedBeforeMessageId: "older-msg-1",
        totalCompactions: 0,
      },
    },
    createdSessionDetail: {
      session: {
        id: "sess-created",
        projectId: "proj-1",
        title: "Created session",
        customTitle: null,
        provider: "codex",
        model: "gpt-5.4-mini",
        ownership: { owner: "self" },
      },
      messages: [
        {
          id: "msg-created-1",
          type: "user",
          timestamp: "2026-04-12T10:06:00.000Z",
          content: "Start a migration plan.",
        },
      ],
      ownership: { owner: "self" },
      pendingInputRequest: null,
      pagination: {
        hasOlderMessages: false,
        totalMessageCount: 1,
        returnedMessageCount: 1,
        totalCompactions: 0,
      },
    },
    processes: [
      {
        id: "proc-1",
        sessionId: "sess-existing",
        sessionTitle: "Historical provider session",
        projectId: "proj-1",
        projectName: "Alpha Project",
        provider: "claude-ollama",
        state: "running",
        model: "claude-sonnet",
      },
    ],
    settings: {
      globalInstructions: "Stay concise.",
      newSessionDefaults: {
        provider: "claude",
        model: "claude-sonnet",
        permissionMode: "default",
      },
    },
  };

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const { pathname, searchParams } = url;

    if (pathname === "/api/projects" && request.method() === "GET") {
      await route.fulfill({ json: { projects: state.projects } });
      return;
    }

    if (pathname === "/api/projects" && request.method() === "POST") {
      const body = request.postDataJSON() as { path?: string };
      const created = {
        id: "proj-2",
        name: "Added Project",
        path: body.path ?? "/workspace/new-project",
        provider: "claude",
        sessionCount: 0,
        activeOwnedCount: 0,
        activeExternalCount: 0,
        lastActivity: null,
      };
      state.projects.push(created);
      await route.fulfill({ json: { project: created } });
      return;
    }

    if (pathname === "/api/providers") {
      await route.fulfill({
        json: {
          providers: [
            {
              name: "claude",
              displayName: "Claude",
              installed: true,
              authenticated: true,
              enabled: true,
              models: [{ id: "claude-sonnet", name: "Claude Sonnet" }],
            },
            {
              name: "codex",
              displayName: "Codex",
              installed: true,
              authenticated: true,
              enabled: true,
              models: [{ id: "gpt-5.4-mini", name: "GPT-5.4 Mini" }],
            },
            {
              name: "codex-oss",
              displayName: "Codex OSS",
              installed: true,
              authenticated: true,
              enabled: false,
              models: [],
            },
          ],
        },
      });
      return;
    }

    if (pathname === "/api/processes" && searchParams.get("includeTerminated") === "true") {
      await route.fulfill({
        json: {
          processes: state.processes,
          terminatedProcesses: [],
        },
      });
      return;
    }

    if (pathname === "/api/settings" && request.method() === "GET") {
      await route.fulfill({ json: { settings: state.settings } });
      return;
    }

    if (pathname === "/api/settings" && request.method() === "PUT") {
      const body = request.postDataJSON() as typeof state.settings;
      state.settings = body;
      await route.fulfill({ json: { settings: state.settings } });
      return;
    }

    if (pathname === "/api/version") {
      await route.fulfill({
        json: {
          current: "0.0.1",
          latest: null,
          updateAvailable: false,
          capabilities: [],
        },
      });
      return;
    }

    if (pathname === "/api/projects/proj-1/sessions" && request.method() === "GET") {
      await route.fulfill({ json: { sessions: state.sessions } });
      return;
    }

    if (pathname === "/api/projects/proj-1/sessions" && request.method() === "POST") {
      await route.fulfill({
        json: {
          sessionId: "sess-created",
          processId: "proc-created",
          permissionMode: "plan",
          modeVersion: 0,
        },
      });
      return;
    }

    if (pathname === "/api/projects/proj-1/sessions/create" && request.method() === "POST") {
      await route.fulfill({
        json: {
          sessionId: "sess-created",
          processId: "proc-created",
          permissionMode: "plan",
          modeVersion: 0,
        },
      });
      return;
    }

    if (
      pathname === "/api/projects/proj-1/sessions/sess-created/resume" &&
      request.method() === "POST"
    ) {
      await route.fulfill({
        json: {
          sessionId: "sess-created",
          processId: "proc-created",
          permissionMode: "plan",
          modeVersion: 0,
        },
      });
      return;
    }

    if (pathname === "/api/projects/proj-1/sessions/sess-existing" && request.method() === "GET") {
      await route.fulfill({ json: state.sessionDetail });
      return;
    }

    if (pathname === "/api/projects/proj-1/sessions/sess-created" && request.method() === "GET") {
      await route.fulfill({ json: state.createdSessionDetail });
      return;
    }

    if (pathname === "/api/sessions/sess-existing/stream") {
      await route.fulfill({
        status: 204,
        contentType: "text/event-stream",
        body: "",
      });
      return;
    }

    if (pathname === "/api/sessions/sess-created/stream") {
      await route.fulfill({
        status: 204,
        contentType: "text/event-stream",
        body: "",
      });
      return;
    }

    if (pathname === "/api/sessions/sess-existing/input" && request.method() === "POST") {
      state.sessionDetail.pendingInputRequest = null;
      await route.fulfill({ json: { accepted: true } });
      return;
    }

    if (pathname === "/api/sessions/sess-existing/messages" && request.method() === "POST") {
      await route.fulfill({ json: { queued: true, processId: "proc-1" } });
      return;
    }

    if (pathname === "/api/processes/proc-1/interrupt" && request.method() === "POST") {
      state.processes[0].state = "waiting";
      await route.fulfill({ json: { interrupted: true, supported: true } });
      return;
    }

    if (pathname === "/api/processes/proc-1/abort" && request.method() === "POST") {
      state.processes[0].state = "terminated";
      await route.fulfill({ json: { aborted: true } });
      return;
    }

    if (pathname === "/api/projects/proj-1/files" && request.method() === "GET") {
      await route.fulfill({
        json: {
          metadata: {
            path: "README.md",
            size: 128,
            mimeType: "text/markdown",
          },
          content: "# README\n\nHello from file view.",
          rawUrl: "/api/projects/proj-1/files/raw?path=README.md",
        },
      });
      return;
    }

    await route.fulfill({
      status: 404,
      json: { error: `Unhandled test route: ${request.method()} ${pathname}` },
    });
  });
});

test("renders the first-stage workbench shell and excludes unsupported navigation", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Scholaraio Hub" })).toBeVisible();
  await expect(
    page.getByText("Local workbench rebuilt against the current server API."),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Projects", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sessions", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Agents", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "New Session", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByText("Inbox")).toHaveCount(0);
  await expect(page.getByText("Activity")).toHaveCount(0);
  await expect(page.getByText("Remote")).toHaveCount(0);
  await expect(page.getByText("Relay")).toHaveCount(0);
});

test("covers projects, sessions, session detail, agents, settings, file, and new-session flows", async ({
  page,
}) => {
  await page.goto("/projects");

  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await expect(page.getByText("/workspace/alpha")).toBeVisible();
  await page.getByPlaceholder("/absolute/path/to/project").fill("/workspace/new-project");
  await page.getByRole("button", { name: "Add Project" }).click();
  await expect(page.getByText("/workspace/new-project")).toBeVisible();

  await page
    .getByRole("link", { name: "Alpha Project /workspace/alpha 2 sessions 1 active" })
    .click();
  await expect(page).toHaveURL(/\/sessions\?project=proj-1$/);
  await expect(page.getByRole("heading", { name: "Sessions" })).toBeVisible();
  await expect(page.getByText("Historical provider session")).toBeVisible();
  await expect(page.getByText("Claude Ollama")).toBeVisible();

  await page.getByRole("link", { name: /Historical provider session/ }).click();
  await expect(page).toHaveURL(/\/projects\/proj-1\/sessions\/sess-existing$/);
  await expect(page.getByText("Pending Input:")).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Interrupt" })).toBeVisible();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("Pending Input:")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Load older messages" })).toBeVisible();

  await page.getByRole("link", { name: "Agents" }).click();
  await expect(page.getByRole("heading", { name: "Agents" })).toBeVisible();
  await expect(page.getByText("running")).toBeVisible();

  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await page
    .getByPlaceholder("Global instructions for new sessions")
    .fill("Stay concise and grounded.");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Settings saved.")).toBeVisible();

  await page.goto("/projects/proj-1/file?path=README.md");
  await expect(page.getByText("README.md")).toBeVisible();
  await expect(page.getByText("Hello from file view.")).toBeVisible();

  await page.goto("/new-session?projectId=proj-1");
  await expect(page.getByRole("heading", { name: "New Session" })).toBeVisible();
  const providerSelect = page.locator("select").nth(1);
  await expect(providerSelect).toHaveValue("claude");
  await expect(providerSelect.locator("option")).toHaveCount(2);
  await page.locator('input[type="file"]').setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("notes"),
  });
  await expect(page.getByText("1 attachments selected")).toBeVisible();
  await page.goto("/new-session?projectId=proj-1");
  await expect(page.getByRole("heading", { name: "New Session" })).toBeVisible();
  await providerSelect.selectOption("codex");
  await page.locator("select").nth(2).selectOption("gpt-5.4-mini");
  await page.locator("select").nth(3).selectOption("plan");
  await page.locator("textarea").fill("Start a migration plan.");
  await page.getByRole("button", { name: "Start Session" }).click();
  await expect(page).toHaveURL(/\/projects\/proj-1\/sessions\/sess-created$/);
  await expect(page.getByText("Created session")).toBeVisible();
});
