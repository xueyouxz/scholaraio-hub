import { afterEach, describe, expect, it, vi } from "vitest";
import { libraryUrl } from "../http";
import { libraryApi } from "../library";

const LIBRARY = `${window.location.origin}/api/library`;

describe("libraryUrl", () => {
  it("uses the page's origin for library settings, documents and MCP", () => {
    for (const path of ["", "/settings", "/papers", "/mcp/"])
      expect(libraryUrl(path)).toBe(`${LIBRARY}${path}`);
  });

  it("rejects paths that could replace the public host", () => {
    for (const path of ["//evil.example/settings", "https://evil.example/settings"])
      expect(() => libraryUrl(path)).toThrow("single slash");
  });
});

describe("citation views", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks for a paper's references within the open collection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(apiResponse({ references: [] })));
    await libraryApi.references("paper 1", undefined, "综述 A");
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(
      `${LIBRARY}/papers/paper%201/references?collectionId=%E7%BB%BC%E8%BF%B0+A`,
    );
  });

  it("asks for cited-by across the whole library when no collection is open", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(apiResponse({ citing: [] })));
    await libraryApi.citing("paper-1");
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(`${LIBRARY}/papers/paper-1/citing`);
  });
});

describe("library capabilities", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("starts a named task and can stop the same one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => apiResponse({ kind: "semantic" })),
    );
    await libraryApi.startTask("semantic");
    await libraryApi.cancelTask("semantic");
    expect(vi.mocked(fetch).mock.calls[0]).toEqual([
      `${LIBRARY}/tasks/semantic`,
      expect.objectContaining({ method: "POST" }),
    ]);
    expect(vi.mocked(fetch).mock.calls[1]).toEqual([
      `${LIBRARY}/tasks/semantic`,
      expect.objectContaining({ method: "DELETE" }),
    ]);
  });
});

/** 构造成功的 API JSON 响应。 */
function apiResponse(data: unknown) {
  return Response.json({ id: "request-test", code: "success", message: "success", data });
}
