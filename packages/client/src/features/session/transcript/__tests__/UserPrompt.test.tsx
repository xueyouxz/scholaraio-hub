import type { SessionMessage } from "@scholaraio-hub/shared";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SessionMessages } from "../SessionMessages";
import { UserPrompt } from "../UserPrompt";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeAll(() => {
  // jsdom has no modal dialogs; the viewer only needs them to open and close.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false;
  };
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  vi.unstubAllGlobals();
});

function render(parts: SessionMessage["parts"]) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<UserPrompt message={{ id: "m", role: "user", parts }} />));
  return container;
}

async function flush() {
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const file = (filename: string, mediaType: string) =>
  ({ type: "file", filename, mediaType, url: `/files/${filename}` }) as const;
const dialog = () => document.querySelector("dialog");
const click = (element: Element | null | undefined) =>
  act(() => (element as HTMLElement | null)?.click());

describe("UserPrompt attachments", () => {
  it("shows pictures and videos, then documents, above the bubble and apart from it", () => {
    const view = render([
      file("paper.pdf", "application/pdf"),
      file("figure.png", "image/png"),
      file("data.csv", "text/csv"),
      file("run.mp4", "video/mp4"),
      { type: "text", text: "Look at these" },
    ]);
    const [attachments, bubble] = Array.from(
      view.querySelector(".user-prompt-container")?.children ?? [],
    );
    const rows = Array.from(attachments?.children ?? []).map((row) =>
      row.getAttribute("aria-label"),
    );
    expect(rows).toEqual(["图片和视频", "文档"]);
    expect(bubble?.classList.contains("message-user-prompt")).toBe(true);
    expect(bubble?.textContent).toBe("Look at these");
    expect(bubble?.querySelector("button, img, video")).toBeNull();

    const media = view.querySelector('[aria-label="图片和视频"]');
    expect(media?.querySelector("img")?.getAttribute("src")).toBe("/files/figure.png");
    expect(media?.querySelector("video")?.getAttribute("src")).toBe("/files/run.mp4#t=0.1");
    const documents = Array.from(
      view.querySelectorAll('[aria-label="文档"] button[data-kind]'),
    ).map((card) => [card.getAttribute("data-kind"), card.textContent]);
    expect(documents).toEqual([
      ["pdf", "paper.pdfpdf"],
      ["spreadsheet", "data.csvcsv"],
    ]);
    expect(view.textContent).not.toContain("📎");
  });

  it("shows no empty bubble when the message is only files", () => {
    const view = render([file("notes.txt", "text/plain")]);
    expect(view.querySelector(".message-user-prompt")).toBeNull();
    expect(view.querySelector('[aria-label="文档"] button')?.textContent).toContain("notes.txt");
  });
});

describe("UserPrompt attachment viewer", () => {
  it("opens a picture in a dialog without changing the transcript", async () => {
    const view = render([file("figure.png", "image/png"), file("more.png", "image/png")]);
    const before = view.innerHTML;
    click(view.querySelector('button[aria-label="查看图片 figure.png"]'));
    await flush();
    expect(dialog()?.open).toBe(true);
    expect(dialog()?.querySelector("img")?.getAttribute("src")).toBe("/files/figure.png");
    expect(view.innerHTML).toBe(before);

    click(dialog()?.querySelector('button[aria-label="关闭"]'));
    expect(dialog()).toBeNull();
  });

  it("reads a text file and shows it", async () => {
    const fetch = vi.fn(async () => new Response("print('hi')"));
    vi.stubGlobal("fetch", fetch);
    render([file("main.py", "text/x-python")]);
    click(document.querySelector('[aria-label="文档"] button'));
    await flush();
    expect(fetch).toHaveBeenCalledWith("/files/main.py", expect.anything());
    expect(dialog()?.querySelector("pre")?.textContent).toBe("print('hi')");
  });

  it("shows only the file and a close control, and closes from the backdrop", async () => {
    render([file("figure.png", "image/png")]);
    click(document.querySelector('button[aria-label="查看图片 figure.png"]'));
    await flush();
    expect(dialog()?.querySelectorAll("img")).toHaveLength(1);
    expect(dialog()?.querySelector("h2, a")).toBeNull();
    click(dialog()?.querySelector('button[aria-hidden="true"]'));
    expect(dialog()).toBeNull();
  });

  it("says when it cannot show a file, without offering anything else", async () => {
    render([file("sheet.xlsx", "application/vnd.ms-excel")]);
    click(document.querySelector('[aria-label="文档"] button'));
    await flush();
    expect(dialog()?.textContent).toContain("无法在这里预览");
    expect(dialog()?.querySelector("a")).toBeNull();
  });
});

describe("SessionMessages prompt actions", () => {
  const prompt = (id: string, text: string): SessionMessage => ({
    id,
    role: "user",
    parts: [{ type: "text", text }],
  });
  const answer = (id: string): SessionMessage => ({
    id,
    role: "assistant",
    parts: [{ type: "text", text: "ok" }],
  });
  function renderList(editingId?: string) {
    const actions = { onEdit: vi.fn(), onFork: vi.fn() };
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() =>
      root?.render(
        <SessionMessages
          messages={[prompt("u1", "一"), answer("a1"), prompt("u2", "二"), answer("a2")]}
          streaming={false}
          provider="claude"
          promptActions={actions}
          editingId={editingId}
        />,
      ),
    );
    return { view: container, actions };
  }
  const labels = (view: HTMLElement) =>
    Array.from(view.querySelectorAll(".user-prompt-container")).map((prompt) =>
      Array.from(prompt.querySelectorAll(".message-action")).map((action) =>
        action.getAttribute("aria-label"),
      ),
    );

  it("offers edit on the last prompt only; fork on every one", () => {
    const { view, actions } = renderList();
    expect(labels(view)).toEqual([
      ["复制消息", "从这里分叉"],
      ["复制消息", "编辑消息", "从这里分叉"],
    ]);
    click(view.querySelector('button[aria-label="编辑消息"]'));
    expect(actions.onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "u2" }));
  });

  it("marks the prompt being corrected and holds its actions", () => {
    const { view } = renderList("u2");
    const prompts = view.querySelectorAll(".user-prompt-container");
    expect(prompts[1]?.classList.contains("is-editing")).toBe(true);
    expect(prompts[0]?.classList.contains("is-editing")).toBe(false);
    expect(
      (view.querySelector('button[aria-label="编辑消息"]') as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
