import { describe, expect, it, vi } from "vitest";
import { createHttpClient } from "../http";
import { createLibraryClient } from "../libraryClient";

/** 创建使用模拟网络的文献客户端。 */
function setup() {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockImplementation(async () =>
      Response.json({ id: "r1", code: "success", message: "success", data: { id: "result" } }),
    );
  const client = createLibraryClient(
    createHttpClient({ baseUrl: "https://library.example", fetchImpl: fetchMock }),
  );
  return { client, fetchMock };
}

describe("library client", () => {
  it("encodes path and query values without changing their meaning", async () => {
    const { client, fetchMock } = setup();
    await client.request("get", "/papers/{paper_id}/references", {
      path: { paper_id: "paper/1 ?" },
      query: { projectId: "Project & A" },
    });
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/papers/paper%2F1%20%3F/references");
    expect(url.searchParams.get("projectId")).toBe("Project & A");
    expect([...url.searchParams.keys()]).toEqual(["projectId"]);
  });

  it("serializes schema-defined bodies and unwraps results", async () => {
    const { client, fetchMock } = setup();
    await expect(
      client.request("post", "/projects", { body: { name: "Research" } }),
    ).resolves.toEqual({ id: "result" });
    const options = fetchMock.mock.calls[0]?.[1];
    expect(options?.method).toBe("POST");
    expect(JSON.parse(String(options?.body))).toEqual({ name: "Research" });
  });

  it("passes multipart bodies without setting the boundary header", async () => {
    const { client, fetchMock } = setup();
    const form = new FormData();
    form.append("files", new File(["pdf"], "paper.pdf"));
    await client.request("post", "/imports", { form });
    const options = fetchMock.mock.calls[0]?.[1];
    expect(options?.body).toBe(form);
    expect(new Headers(options?.headers).has("Content-Type")).toBe(false);
  });
});
