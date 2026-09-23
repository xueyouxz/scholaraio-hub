import { afterEach, describe, expect, it, vi } from "vitest";
import { libraryApi, sessionApi } from "../library";

describe("first session message recovery", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("releases the initial stream after the server accepts the message", async () => {
    const cancel = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel }))));
    await sessionApi.begin("session-1", "message-1", "总结本文");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "/api/sessions/session-1/messages",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ id: "message-1", text: "总结本文", attachmentIds: [] }),
      }),
    );
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("recognizes an accepted message when the initial response is lost", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValueOnce(new Error("connection lost"))
        .mockResolvedValueOnce(
          Response.json({ messages: [{ id: "message-1", role: "user", parts: [] }] }),
        ),
    );
    await expect(sessionApi.begin("session-1", "message-1", "总结本文")).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.calls[1]?.[0]).toBe("/api/sessions/session-1");
  });

  it("reports a rejected message so the composer can retain its draft for retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
        .mockResolvedValueOnce(Response.json({ messages: [] })),
    );
    await expect(sessionApi.begin("session-1", "message-1", "总结本文")).rejects.toThrow("503");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("citation views", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks for a paper's references within the open project", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ references: [] })));
    await libraryApi.references("paper 1", undefined, "综述 A");
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(
      "/api/library/papers/paper%201/references?projectId=%E7%BB%BC%E8%BF%B0%20A",
    );
  });

  it("asks for cited-by across the whole library when no project is open", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ citing: [] })));
    await libraryApi.citing("paper-1");
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe("/api/library/papers/paper-1/citing");
  });
});
