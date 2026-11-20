import type { LibrarySettings } from "@scholaraio-hub/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { libraryApi } from "../../../core/library";
import { LibrarySettingsForm } from "../components/LibrarySettingsForm";

vi.mock("../components/CapabilityPrompt", () => ({ CapabilityPrompt: () => null }));

const snapshot: LibrarySettings = {
  extractor: "auto",
  pdfParser: "mineru",
  llmBackend: "openai-compat",
  llmModel: "example-chat",
  llmBaseUrl: "https://chat.example/v1",
  llmConfigured: false,
  llmKeyLength: 0,
  mineruEndpoint: "http://parser:18000",
  mineruBackend: "basic",
  mineruConfigured: false,
  mineruKeyLength: 0,
  embedProvider: "local",
  embedModel: "Qwen/Qwen3-Embedding-0.6B",
  embedSource: "modelscope",
  embedDevice: "auto",
  embedApiBase: "https://embeddings.example/v1",
  embedApiConfigured: true,
  embedKeyLength: 10,
  configPath: "/config.yaml",
  papersDir: "/papers",
  workspaceDir: "/workspace",
};

let root: Root;
let host: HTMLDivElement;
let client: QueryClient;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient({
    defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, retry: false } },
  });
  vi.spyOn(libraryApi, "checkSettings").mockImplementation(async (target) => ({
    target,
    ok: true,
    level: "ok",
    message: "Ready",
  }));
});

afterEach(() => {
  act(() => root.unmount());
  client.clear();
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function show(settings: LibrarySettings) {
  client.setQueryData(["library", "settings"], settings);
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <LibrarySettingsForm />
      </QueryClientProvider>,
    );
    await vi.advanceTimersByTimeAsync(1000);
  });
}

function embeddingChecks() {
  return vi.mocked(libraryApi.checkSettings).mock.calls.filter(([target]) => target === "embed");
}

describe("API embedding settings", () => {
  it("shows saved API settings and checks the API only on an explicit click", async () => {
    await show({ ...snapshot, embedProvider: "openai-compat", embedModel: "example-embedding" });
    expect(host.querySelector<HTMLInputElement>("#setting-embedApiBase")?.value).toBe(
      snapshot.embedApiBase,
    );
    const secret = host.querySelector<HTMLInputElement>("#setting-embedApiKey");
    expect(secret?.type).toBe("password");
    expect(secret?.value).toBe("•".repeat(10));
    expect(host.textContent).toContain("无需下载本地模型");
    expect(embeddingChecks()).toHaveLength(0);
    await act(async () => {
      secret?.parentElement?.querySelector("button")?.click();
    });
    expect(embeddingChecks()).toHaveLength(1);
  });

  it("saves the chosen provider and retains API mode on later settings updates", async () => {
    let current = { ...snapshot };
    vi.spyOn(libraryApi, "saveSettings").mockImplementation(async (patch) => {
      current = { ...current, ...patch };
      return current;
    });
    await show(current);
    const select = host.querySelector<HTMLSelectElement>("#setting-embedProvider");
    await act(async () => {
      if (!select) throw new Error("Missing embedding provider selector");
      select.value = "openai-compat";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(libraryApi.saveSettings).toHaveBeenCalledWith({ embedProvider: "openai-compat" });
    expect(host.querySelector("#setting-embedApiKey")).not.toBeNull();
    const initialChecks = embeddingChecks().length;
    await act(async () => {
      client.setQueryData(["library", "settings"], { ...current, embedModel: "another-embedding" });
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(host.querySelector<HTMLSelectElement>("#setting-embedProvider")?.value).toBe(
      "openai-compat",
    );
    expect(embeddingChecks()).toHaveLength(initialChecks);
  });
});
