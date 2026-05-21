import type { UploadedFile } from "@scholaraio-hub/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

function mockJsonResponse(payload: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
}

function lastRequestBody() {
  const fetchMock = vi.mocked(fetch);
  const init = fetchMock.mock.calls.at(-1)?.[1];
  if (!init || typeof init.body !== "string") {
    throw new Error("Expected JSON request body");
  }
  return JSON.parse(init.body) as Record<string, unknown>;
}

describe("core api session mutations", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends tempId and deferred flags when queueing messages", async () => {
    mockJsonResponse({ queued: true, deferred: true });

    await api.queueMessage({
      sessionId: "session-1",
      message: "follow up",
      mode: "default",
      thinking: "auto",
      tempId: "temp-1",
      deferred: true,
    });

    expect(fetch).toHaveBeenCalledWith(
      "/api/sessions/session-1/messages",
      expect.objectContaining({ method: "POST" }),
    );
    expect(lastRequestBody()).toMatchObject({
      message: "follow up",
      mode: "default",
      thinking: "auto",
      tempId: "temp-1",
      deferred: true,
    });
  });

  it("sends attachments and tempId when resuming sessions", async () => {
    mockJsonResponse({ processId: "process-1" });
    const attachment: UploadedFile = {
      id: "file-1",
      originalName: "notes.txt",
      name: "file-1-notes.txt",
      path: "/tmp/file-1-notes.txt",
      size: 12,
      mimeType: "text/plain",
    };

    await api.resumeSession({
      projectId: "project-1",
      sessionId: "session-1",
      message: "resume",
      mode: "acceptEdits",
      model: "sonnet",
      thinking: "on:medium",
      provider: "claude",
      executor: "remote-main",
      remoteEnv: { WORKSPACE_ID: "workspace-1" },
      permissions: { allow: ["Bash(pnpm test)"], deny: ["Bash(curl *)"] },
      attachments: [attachment],
      tempId: "temp-2",
    });

    expect(fetch).toHaveBeenCalledWith(
      "/api/projects/project-1/sessions/session-1/resume",
      expect.objectContaining({ method: "POST" }),
    );
    expect(lastRequestBody()).toMatchObject({
      message: "resume",
      mode: "acceptEdits",
      model: "sonnet",
      thinking: "on:medium",
      provider: "claude",
      executor: "remote-main",
      remoteEnv: { WORKSPACE_ID: "workspace-1" },
      permissions: { allow: ["Bash(pnpm test)"], deny: ["Bash(curl *)"] },
      attachments: [attachment],
      tempId: "temp-2",
    });
  });

  it("does not leak path params into create session request bodies", async () => {
    mockJsonResponse({ sessionId: "session-1", processId: "process-1" });

    await api.createSession({
      projectId: "project-1",
      mode: "plan",
      model: "sonnet",
      thinking: "auto",
      provider: "claude",
      executor: "remote-main",
    });

    expect(fetch).toHaveBeenCalledWith(
      "/api/projects/project-1/sessions/create",
      expect.objectContaining({ method: "POST" }),
    );
    expect(lastRequestBody()).toEqual({
      mode: "plan",
      model: "sonnet",
      thinking: "auto",
      provider: "claude",
      executor: "remote-main",
    });
  });
});
