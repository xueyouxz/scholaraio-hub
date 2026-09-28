import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatReferences,
  newSessionUrl,
  parseReferences,
  sessionApi,
  sessionInput,
  sessionUrl,
} from "../sessions";

describe("starting a session", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends the new session and its first message in one request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(apiResponse({ id: "claude:abc" })));
    const session = await sessionApi.create({
      provider: "claude",
      cwd: "/w/app",
      references: [{ kind: "collection", id: "c1" }],
      message: { id: "m1", text: "总结", attachmentIds: [], references: [] },
    });
    expect(session.id).toBe("claude:abc");
    const [url, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(url).toBe("/api/sessions");
    expect(JSON.parse(String(init?.body))).toEqual({
      provider: "claude",
      cwd: "/w/app",
      references: [{ kind: "collection", id: "c1" }],
      message: { id: "m1", text: "总结", attachmentIds: [], references: [] },
    });
  });
});

describe("session addresses", () => {
  it("keeps the colon of a session id readable in the page address, and escapes it in the API's", () => {
    expect(sessionUrl("codex:01a0e7a4")).toBe("/sessions/codex:01a0e7a4");
  });

  it("writes references into a new chat's address and reads them back", () => {
    const references = [
      { kind: "paper", id: "p1" },
      { kind: "collection", id: "综述" },
    ] as const;
    expect(parseReferences(formatReferences([...references]))).toEqual(references);
    expect(parseReferences("paper:p1,bogus:x,paper:p1,collection:")).toEqual([
      { kind: "paper", id: "p1" },
    ]);
    const url = new URL(
      newSessionUrl({ project: "L3cvYXBw", references: [...references] }),
      "http://hub.test",
    );
    expect(url.pathname).toBe("/sessions");
    expect(url.searchParams.get("project")).toBe("L3cvYXBw");
    expect(parseReferences(url.searchParams.get("refs"))).toEqual(references);
  });
});

describe("sessionInput", () => {
  it("sends the text and re-sends only this session's own uploads", () => {
    expect(
      sessionInput("claude:s1", {
        id: "m1",
        role: "user",
        parts: [
          { type: "text", text: "总结" },
          {
            type: "file",
            mediaType: "image/png",
            url: "/api/sessions/claude%3As1/attachments/a1",
          },
          {
            type: "file",
            mediaType: "image/png",
            url: "/api/sessions/claude%3As2/attachments/a2",
          },
          { type: "text", text: "本文" },
        ],
      }),
    ).toEqual({ id: "m1", text: "总结\n本文", attachmentIds: ["a1"], references: [] });
  });
});

/** 构造成功的 API JSON 响应。 */
function apiResponse(data: unknown) {
  return Response.json({ id: "request-test", code: "success", message: "success", data });
}
