import { LIBRARY_PORT_META } from "@scholaraio-hub/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { libraryUrl } from "../http";
import { libraryApi } from "../library";

/** The page names the library service's port; the browser calls it on the page's host. */
beforeEach(() => {
  const meta = document.createElement("meta");
  meta.name = LIBRARY_PORT_META;
  meta.content = "3501";
  document.head.append(meta);
});
afterEach(() => {
  for (const meta of document.head.querySelectorAll("meta")) meta.remove();
});

const LIBRARY = `${window.location.protocol}//${window.location.hostname}:3501`;

describe("libraryUrl", () => {
  it("calls the library service directly, on the host the page came from", () => {
    expect(libraryUrl("/papers")).toBe(`${LIBRARY}/papers`);
  });

  it("says so when the page does not name the service", () => {
    for (const meta of document.head.querySelectorAll("meta")) meta.remove();
    expect(() => libraryUrl("/papers")).toThrow("library service port");
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
