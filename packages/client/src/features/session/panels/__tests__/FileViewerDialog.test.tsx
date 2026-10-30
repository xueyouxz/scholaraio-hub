import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Markdown } from "../../../../shared/components/Markdown";
import { SessionFileLinks } from "../FileViewerDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeAll(() => {
  // jsdom has no modal dialogs or scrolling; the viewer only needs them to be callable.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false;
  };
  Element.prototype.scrollIntoView ??= () => {};
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  vi.unstubAllGlobals();
});

async function flush() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function render(text: string, inSession = true) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const markdown = <Markdown text={text} className="session-markdown" />;
  act(() =>
    root?.render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          {inSession ? (
            <SessionFileLinks sessionId="claude:s1" cwd="/repo">
              {markdown}
            </SessionFileLinks>
          ) : (
            markdown
          )}
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
  await flush();
  return container;
}

const served = (content: string | undefined) =>
  vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          id: "r",
          code: "success",
          message: "success",
          data: { content, size: 20, truncated: false, rawUrl: "/api/raw" },
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
  );

const viewer = () => document.querySelector<HTMLDialogElement>("dialog.file-viewer-dialog");

describe("file links in an answer", () => {
  it("open the file over the session, at the linked line", async () => {
    const fetch = served("one\ntwo\nthree\n");
    vi.stubGlobal("fetch", fetch);
    const view = await render("See [app.ts](/repo/src/app.ts:2) for it.");
    const link = view.querySelector<HTMLButtonElement>("button.file-link");
    expect(link?.textContent).toBe("app.ts");
    expect(view.querySelector("a")).toBeNull();
    act(() => link?.click());
    await flush();
    expect(fetch).toHaveBeenCalledWith(
      `/api/sessions/claude%3As1/fs/file?path=${encodeURIComponent("/repo/src/app.ts")}`,
      expect.anything(),
    );
    expect(viewer()?.open).toBe(true);
    expect(viewer()?.querySelector(".file-viewer-path")?.textContent).toBe("src/app.ts:2");
    const lines = [...(viewer()?.querySelectorAll(".file-line") ?? [])];
    expect(lines.map((line) => line.querySelector(".file-line-text")?.textContent)).toEqual([
      "one",
      "two",
      "three",
    ]);
    expect(lines.map((line) => line.hasAttribute("data-marked"))).toEqual([false, true, false]);
    act(() => viewer()?.querySelector<HTMLButtonElement>('[aria-label="关闭"]')?.click());
    expect(viewer()).toBeNull();
  });

  it("survive the sanitizer as relative paths, with or without a line", async () => {
    vi.stubGlobal("fetch", served("# Title"));
    const view = await render(
      "[readme](README.md:3), [app](src/app.ts), [guide][g]\n\n[g]: docs/guide.md#L4-L9",
    );
    expect(
      [...view.querySelectorAll<HTMLButtonElement>("button.file-link")].map((link) => link.title),
    ).toEqual(["README.md:3", "src/app.ts", "docs/guide.md:4-9"]);
    expect(view.textContent).not.toContain("[blocked]");
  });

  it("say so when the file cannot be shown", async () => {
    vi.stubGlobal("fetch", served(undefined));
    const view = await render("[logo](assets/logo.png)");
    act(() => view.querySelector<HTMLButtonElement>("button.file-link")?.click());
    await flush();
    expect(viewer()?.textContent).toContain("二进制文件无法在这里预览");
  });

  it("stay web links when they point at the web, and plain text outside a session", async () => {
    let view = await render("[docs](https://example.com/a.ts:3) [app](src/app.ts)", false);
    expect(view.querySelector("a")?.getAttribute("href")).toBe("https://example.com/a.ts:3");
    expect(view.querySelector("button")).toBeNull();
    expect(view.textContent).toContain("app");
    act(() => root?.unmount());
    container?.remove();
    view = await render("[run](javascript:1)");
    expect(view.querySelector("button.file-link")).toBeNull();
    expect(view.querySelector('a[href^="javascript"]')).toBeNull();
  });
});
