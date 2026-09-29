import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { providersQuery } from "../providers";

const claude = {
  name: "claude",
  models: [{ id: "opus", name: "Opus" }],
  capabilities: { permissionModes: [{ id: "default", label: "Default" }], thinkingModes: [] },
};

const served = (providers: unknown[]) =>
  vi.fn(
    async () =>
      new Response(
        JSON.stringify({ id: "r", code: "success", message: "success", data: { providers } }),
        { headers: { "Content-Type": "application/json" } },
      ),
  );

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("providersQuery", () => {
  it("starts from the last list this browser saw, and asks again at once", async () => {
    localStorage.setItem("hub-providers:last", JSON.stringify({ providers: [claude] }));
    const fetch = served([{ ...claude, models: [] }]);
    vi.stubGlobal("fetch", fetch);
    const client = new QueryClient();
    const observer = client.getQueryCache().build(client, providersQuery);
    expect(observer.state.data).toEqual({ providers: [claude] });
    expect(observer.isStaleByTime(providersQuery.staleTime as number)).toBe(true);
    await client.fetchQuery(providersQuery);
    expect(fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(localStorage.getItem("hub-providers:last") ?? "")).toEqual({
      providers: [{ ...claude, models: [] }],
    });
  });

  it("ignores a saved list it cannot read", () => {
    localStorage.setItem("hub-providers:last", JSON.stringify({ providers: [{ name: "claude" }] }));
    const client = new QueryClient();
    expect(client.getQueryCache().build(client, providersQuery).state.data).toBeUndefined();
  });
});
