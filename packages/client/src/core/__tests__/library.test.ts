import { afterEach, describe, expect, it, vi } from "vitest";
import { sessionApi } from "../library";

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
