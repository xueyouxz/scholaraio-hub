import { afterEach, describe, expect, it, vi } from "vitest";
import { libraryApi } from "../library";

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

describe("library capabilities", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("starts a named task and can stop the same one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => Response.json({ kind: "semantic" })),
    );
    await libraryApi.startTask("semantic");
    await libraryApi.cancelTask("semantic");
    expect(vi.mocked(fetch).mock.calls[0]).toEqual([
      "/api/library/tasks/semantic",
      expect.objectContaining({ method: "POST" }),
    ]);
    expect(vi.mocked(fetch).mock.calls[1]).toEqual([
      "/api/library/tasks/semantic",
      expect.objectContaining({ method: "DELETE" }),
    ]);
  });
});
