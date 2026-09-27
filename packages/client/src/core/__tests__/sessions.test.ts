import { afterEach, describe, expect, it, vi } from "vitest";
import { sessionApi, sessionInput } from "../sessions";

const input = { id: "message-1", text: "总结本文", attachmentIds: [] };

describe("first session message recovery", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("releases the initial stream after the server accepts the message", async () => {
    const cancel = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel }))));
    await sessionApi.sendFirstMessage("session-1", input);
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
          apiResponse({ messages: [{ id: "message-1", role: "user", parts: [] }] }),
        ),
    );
    await expect(sessionApi.sendFirstMessage("session-1", input)).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.calls[1]?.[0]).toBe("/api/sessions/session-1");
  });

  it("reports a rejected message so the composer can retain its draft for retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
        .mockResolvedValueOnce(apiResponse({ messages: [] })),
    );
    await expect(sessionApi.sendFirstMessage("session-1", input)).rejects.toMatchObject({
      status: 503,
      code: "INVALID_RESPONSE",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("sessionInput", () => {
  it("sends the text and re-sends only this session's own uploads", () => {
    expect(
      sessionInput("s1", {
        id: "m1",
        role: "user",
        parts: [
          { type: "text", text: "总结" },
          { type: "file", mediaType: "image/png", url: "/api/sessions/s1/attachments/a1" },
          { type: "file", mediaType: "image/png", url: "/api/sessions/s2/attachments/a2" },
          { type: "text", text: "本文" },
        ],
      }),
    ).toEqual({ id: "m1", text: "总结\n本文", attachmentIds: ["a1"] });
  });
});

/** 构造成功的 API JSON 响应。 */
function apiResponse(data: unknown) {
  return Response.json({ id: "request-test", code: "success", message: "success", data });
}
