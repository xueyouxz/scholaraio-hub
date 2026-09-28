import type { SlashCommand } from "@scholaraio-hub/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ComponentProps, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

const commands = vi.hoisted(() => ({
  list: [] as SlashCommand[],
  calls: [] as Array<{ provider: string; sessionId?: string }>,
}));

/** Upload fakes: each file resolves when its test says so, or fails if listed. */
const uploads = vi.hoisted(() => ({
  targets: [] as unknown[],
  removed: [] as string[],
  failing: new Set<string>(),
  holding: new Map<string, () => void>(),
  hold: false,
}));

vi.mock("../../../../../core/sessions", () => ({
  sessionApi: {
    commands: async (provider: string, sessionId?: string) => {
      commands.calls.push({ provider, sessionId });
      return { commands: commands.list };
    },
    uploadAttachment: async (target: unknown, file: File) => {
      uploads.targets.push(target);
      if (uploads.hold)
        await new Promise<void>((resolve) => uploads.holding.set(file.name, resolve));
      if (uploads.failing.has(file.name)) throw new Error(`Upload failed: ${file.name}`);
      return {
        id: `id-${file.name}`,
        filename: file.name,
        mediaType: file.type,
        size: file.size,
        url: `/api/x/${file.name}`,
      };
    },
    removeAttachment: async (_target: unknown, id: string) => {
      uploads.removed.push(id);
    },
  },
}));

const uploaded = (name: string) => expect.objectContaining({ id: `id-${name}`, filename: name });

import { Composer, readComposerDraft } from "../Composer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no layout; the suggestion list scrolls its active option into view.
Element.prototype.scrollIntoView ??= () => {};

type Props = ComponentProps<typeof Composer>;

let root: Root | undefined;
let container: HTMLDivElement | undefined;
let queryClient: QueryClient;

beforeEach(() => {
  uploads.targets = [];
  uploads.removed = [];
  uploads.failing.clear();
  uploads.holding.clear();
  uploads.hold = false;
  sessionStorage.clear();
  commands.list = [];
  commands.calls = [];
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  Reflect.deleteProperty(window, "SpeechRecognition");
});

function props(overrides: Partial<Props> = {}): Props {
  return {
    draftKey: "session:s1",
    provider: "claude",
    sessionId: "s1",
    onSend: vi.fn(async () => {}),
    ...overrides,
  };
}

function render(overrides: Partial<Props> = {}) {
  const current = props(overrides);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      <QueryClientProvider client={queryClient}>
        <Composer {...current} />
      </QueryClientProvider>,
    ),
  );
  return current;
}

async function flush() {
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const textarea = () => container?.querySelector("textarea") as HTMLTextAreaElement;
const button = (label: string) =>
  container?.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null;
const alerts = () =>
  Array.from(container?.querySelectorAll('[role="alert"]') ?? []).map((node) => node.textContent);
const suggestions = () =>
  Array.from(container?.querySelectorAll("button[aria-selected]") ?? []).map((node) => ({
    text: node.textContent,
    active: node.getAttribute("aria-selected") === "true",
  }));

function type(value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  act(() => {
    setter?.call(textarea(), value);
    textarea().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function key(init: KeyboardEventInit) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  act(() => {
    textarea().dispatchEvent(event);
  });
  return event;
}

async function press(init: KeyboardEventInit) {
  key(init);
  await flush();
}

function file(name: string, size = 3, type = "text/plain") {
  return new File(["x".repeat(size)], name, { type });
}

function chooseFiles(files: File[]) {
  const input = container?.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, "files", { value: files, configurable: true });
  act(() => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

const chips = () =>
  Array.from(container?.querySelectorAll('[aria-label="Attachments"] li') ?? []).map((node) =>
    node.getAttribute("aria-label"),
  );
const chipStatus = () =>
  Array.from(container?.querySelectorAll('[aria-label="Attachments"] li') ?? []).map((node) =>
    node.getAttribute("data-status"),
  );

describe("Composer keyboard submission", () => {
  it("sends on Enter, then clears the input and the stored draft", async () => {
    const { onSend } = render();
    type("hello");
    expect(sessionStorage.getItem("hub-composer:session:s1")).toBe("hello");

    await press({ key: "Enter" });

    expect(onSend).toHaveBeenCalledWith("hello", []);
    expect(textarea().value).toBe("");
    expect(sessionStorage.getItem("hub-composer:session:s1")).toBeNull();
  });

  it("leaves Enter as a newline on touch devices; the button sends", async () => {
    const matchMedia = vi
      .spyOn(window, "matchMedia")
      .mockImplementation(
        (query) => ({ matches: query === "(pointer: coarse)" }) as MediaQueryList,
      );
    const { onSend } = render();
    type("line one");
    const event = key({ key: "Enter" });
    await flush();
    expect(event.defaultPrevented).toBe(false);
    expect(onSend).not.toHaveBeenCalled();
    act(() => button("Send")?.click());
    await flush();
    expect(onSend).toHaveBeenCalledWith("line one", []);
    matchMedia.mockRestore();
  });

  it("keeps Shift+Enter as a newline and does not send", async () => {
    const { onSend } = render();
    type("hello");
    const event = key({ key: "Enter", shiftKey: true });
    await flush();
    expect(event.defaultPrevented).toBe(false);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("ignores Enter while an IME composition is active", async () => {
    const { onSend } = render();
    type("ni");
    act(() => {
      textarea().dispatchEvent(new Event("compositionstart", { bubbles: true }));
    });
    await press({ key: "Enter" });
    await press({ key: "Enter", isComposing: true });
    expect(onSend).not.toHaveBeenCalled();

    act(() => {
      textarea().dispatchEvent(new Event("compositionend", { bubbles: true }));
    });
    await press({ key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("ni", []);
  });

  it("does not send an empty or whitespace-only message", async () => {
    const { onSend } = render();
    type("   ");
    await press({ key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
    expect(button("Send")?.disabled).toBe(true);
  });

  it("queues with Ctrl+Enter while idle when a queue action exists", async () => {
    const { onSend, onQueue } = render({ onQueue: vi.fn(async () => {}) });
    type("later");
    await press({ key: "Enter", ctrlKey: true });
    expect(onQueue).toHaveBeenCalledWith("later", []);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("routes Enter to the queue while the session is running", async () => {
    const { onSend, onQueue } = render({ running: true, onQueue: vi.fn(async () => {}) });
    type("follow up");
    await press({ key: "Enter" });
    expect(onQueue).toHaveBeenCalledWith("follow up", []);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("does not send while running when there is no queue action", async () => {
    const { onSend } = render({ running: true });
    type("blocked");
    await press({ key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("does not send while disabled", async () => {
    const { onSend } = render({ disabled: true });
    await press({ key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
    expect(textarea().readOnly).toBe(true);
  });
});

describe("Composer send outcome", () => {
  it("keeps the text and shows the error when sending fails", async () => {
    render({ onSend: vi.fn(async () => Promise.reject(new Error("Network down"))) });
    type("hello");
    await press({ key: "Enter" });
    expect(textarea().value).toBe("hello");
    expect(alerts()).toContain("Network down");
  });

  it("empties the input as soon as the message is handed off, before the send resolves", async () => {
    let resolve: () => void = () => {};
    const onSend = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    render({ onSend });
    type("hello");
    await press({ key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("hello", []);
    expect(textarea().value).toBe("");
    await act(async () => resolve());
    await flush();
    expect(textarea().value).toBe("");
    expect(sessionStorage.getItem("hub-composer:session:s1")).toBeNull();
  });

  it("puts the message back when a pending send fails", async () => {
    let reject: (error: Error) => void = () => {};
    const onSend = vi.fn(
      () =>
        new Promise<void>((_, fail) => {
          reject = fail;
        }),
    );
    render({ onSend });
    type("hello");
    await press({ key: "Enter" });
    expect(textarea().value).toBe("");
    await act(async () => reject(new Error("Network down")));
    await flush();
    expect(textarea().value).toBe("hello");
    expect(alerts()).toContain("Network down");
  });

  it("does not clear text the user edited while the send was in flight", async () => {
    let resolve: () => void = () => {};
    const onSend = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    render({ onSend });
    type("first");
    key({ key: "Enter" });
    type("first, edited");
    await act(async () => resolve());
    await flush();
    expect(textarea().value).toBe("first, edited");
  });

  it("sends only once when Enter is pressed again during an in-flight send", async () => {
    let resolve: () => void = () => {};
    const onSend = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    render({ onSend });
    type("once");
    key({ key: "Enter" });
    key({ key: "Enter" });
    await act(async () => resolve());
    await flush();
    expect(onSend).toHaveBeenCalledTimes(1);
  });
});

describe("Composer draft persistence", () => {
  it("restores the draft for the same key after remounting", () => {
    render();
    type("unfinished thought");
    act(() => root?.unmount());
    container?.remove();

    expect(readComposerDraft("session:s1")).toBe("unfinished thought");
    render();
    expect(textarea().value).toBe("unfinished thought");
  });

  it("keeps drafts separate per key", () => {
    sessionStorage.setItem("hub-composer:session:other", "other draft");
    render();
    expect(textarea().value).toBe("");
  });

  it("uses controlled text instead of the stored draft when provided", () => {
    sessionStorage.setItem("hub-composer:session:s1", "stored");
    const onTextChange = vi.fn();
    render({ text: "from parent", onTextChange });
    expect(textarea().value).toBe("from parent");
    type("edited");
    expect(onTextChange).toHaveBeenCalledWith("edited");
  });
});

describe("Composer slash commands", () => {
  const review: SlashCommand = { name: "review", description: "Review code" };
  const research: SlashCommand = { name: "research", description: "Research", argumentHint: "<q>" };
  const commit: SlashCommand = { name: "commit", description: "Commit" };

  beforeEach(() => {
    commands.list = [review, research, commit];
  });

  it("loads commands for the provider and session", async () => {
    render({ provider: "codex", sessionId: "s9" });
    await flush();
    expect(commands.calls).toEqual([{ provider: "codex", sessionId: "s9" }]);
  });

  it("suggests commands by prefix only at the start of the message", async () => {
    render();
    await flush();
    type("/re");
    expect(suggestions().map((item) => item.text)).toEqual(["/review", "/research <q>"]);
    expect(suggestions()[0]?.active).toBe(true);

    type("please /re");
    expect(suggestions()).toEqual([]);
  });

  it("navigates with arrows and selects with Enter into a badge", async () => {
    const { onSend } = render();
    await flush();
    type("/re");
    key({ key: "ArrowDown" });
    expect(suggestions()[1]?.active).toBe(true);
    key({ key: "ArrowDown" });
    expect(suggestions()[0]?.active).toBe(true);
    key({ key: "ArrowUp" });
    key({ key: "Enter" });
    await flush();

    expect(onSend).not.toHaveBeenCalled();
    expect(suggestions()).toEqual([]);
    expect(container?.textContent).toContain("/research");
    expect(textarea().value).toBe("");

    type("quantum dots");
    await press({ key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("/research quantum dots", []);
  });

  it("selects the active command with Tab", async () => {
    render();
    await flush();
    type("/co");
    key({ key: "Tab" });
    expect(sessionStorage.getItem("hub-composer:session:s1")).toBe("/commit ");
  });

  it("dismisses suggestions with Escape", async () => {
    render();
    await flush();
    type("/re");
    key({ key: "Escape" });
    expect(suggestions()).toEqual([]);
  });

  it("removes the selected command with Backspace on an empty body", async () => {
    render();
    await flush();
    type("/review ");
    expect(textarea().value).toBe("");
    key({ key: "Backspace" });
    expect(sessionStorage.getItem("hub-composer:session:s1")).toBeNull();
    expect(container?.textContent).not.toContain("/review");
  });

  it("completes a Codex skill anywhere in the message as a $mention", async () => {
    commands.list = [
      { name: "cite", description: "Cite", trigger: "$", position: "anywhere" },
      { name: "compact", description: "Compact", position: "leading" },
    ];
    const { onSend } = render({ provider: "codex" });
    await flush();
    type("please /c");
    expect(suggestions().map((item) => item.text)).toEqual(["$cite"]);
    key({ key: "Enter" });
    await flush();
    expect(textarea().value).toBe("please $cite ");
    type("please $cite these papers");
    await press({ key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("please $cite these papers", []);
  });

  it("runs client commands in the browser without sending them", async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    const { onSend } = render();
    await flush();
    type("/att");
    expect(suggestions().map((item) => item.text)).toEqual(["/attach"]);
    key({ key: "Enter" });
    await flush();
    expect(click).toHaveBeenCalled();
    expect(textarea().value).toBe("");
    expect(onSend).not.toHaveBeenCalled();
    click.mockRestore();
  });

  it("opens the model menu for /model when the provider lists models", async () => {
    render({
      controls: {
        provider: "claude",
        info: {
          name: "claude",
          displayName: "Claude",
          installed: true,
          authenticated: true,
          enabled: true,
          models: [{ id: "opus", name: "Opus", isDefault: true }],
          capabilities: {
            permissionModes: [],
            thinkingModes: [],
            slashCommands: "leading",
            contextUsage: "used",
            attachments: { maxBytes: 10, maxCount: 1 },
          },
        },
        options: {},
        onChange: () => {},
      },
    });
    await flush();
    type("/mod");
    key({ key: "Enter" });
    await flush();
    expect(document.querySelector('[role="menu"]')?.textContent).toContain("Opus");
    expect(textarea().value).toBe("");
  });
});

describe("Composer attachments", () => {
  it("uploads files as soon as they are added and sends the uploaded attachments", async () => {
    const { onSend } = render();
    chooseFiles([file("notes.txt")]);
    expect(chips()).toEqual(["notes.txt"]);
    await flush();
    expect(uploads.targets).toEqual([{ sessionId: "s1" }]);
    expect(chipStatus()).toEqual(["uploaded"]);

    await press({ key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("", [uploaded("notes.txt")]);
    expect(chips()).toEqual([]);
  });

  it("empties the tray once the message is handed off and restores it if the send fails", async () => {
    let reject: (error: Error) => void = () => {};
    const onSend = vi.fn(
      () =>
        new Promise<void>((_, fail) => {
          reject = fail;
        }),
    );
    render({ onSend });
    chooseFiles([file("notes.txt")]);
    await flush();
    type("with file");
    await press({ key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("with file", [uploaded("notes.txt")]);
    expect(chips()).toEqual([]);

    await act(async () => reject(new Error("Network down")));
    await flush();
    expect(chips()).toEqual(["notes.txt"]);
    expect(chipStatus()).toEqual(["uploaded"]);
    expect(textarea().value).toBe("with file");
  });

  it("shows pictures and videos as thumbnails and other files by kind and name", async () => {
    const original = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };
    const createObjectURL = vi.fn((blob: Blob) => `blob:${(blob as File).name}`);
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    onTestFinished(() => {
      Object.assign(URL, original);
    });
    render();
    chooseFiles([
      file("photo.png", 3, "image/png"),
      file("clip.mp4", 3, "video/mp4"),
      file("paper.pdf", 3, "application/pdf"),
      file("data.csv", 3, ""),
    ]);
    const tray = container?.querySelector('[aria-label="Attachments"]');
    expect(tray?.querySelector("img")?.getAttribute("src")).toBe("blob:photo.png");
    expect(tray?.querySelector("video")?.getAttribute("src")).toBe("blob:clip.mp4#t=0.1");
    expect(createObjectURL).toHaveBeenCalledTimes(2);
    const kinds = Array.from(tray?.querySelectorAll("li[data-kind]") ?? []).map((node) => [
      node.getAttribute("data-kind"),
      node.textContent,
    ]);
    expect(kinds).toEqual([
      ["pdf", "paper.pdfpdf"],
      ["spreadsheet", "data.csvcsv"],
    ]);
  });

  it("opens a chosen file in the viewer from the tray", async () => {
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.open = true;
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.open = false;
    };
    render();
    chooseFiles([file("notes.txt")]);
    await flush();
    act(() => button("View notes.txt")?.click());
    await flush();
    expect(document.querySelector("dialog")?.getAttribute("aria-label")).toBe("notes.txt");
    act(() => (document.querySelector('dialog button[aria-label="关闭"]') as HTMLElement).click());
    expect(document.querySelector("dialog")).toBeNull();
    expect(chips()).toEqual(["notes.txt"]);
  });

  it("uploads a new chat's files to the draft area", async () => {
    render({ sessionId: undefined, draftKey: "new:" });
    chooseFiles([file("draft.txt")]);
    await flush();
    expect(uploads.targets).toEqual(["draft"]);
  });

  it("keeps typing free while uploading and sends once the upload lands", async () => {
    uploads.hold = true;
    const { onSend } = render();
    chooseFiles([file("big.txt")]);
    type("still typing");
    expect(textarea().value).toBe("still typing");
    expect(chipStatus()).toEqual(["uploading"]);
    key({ key: "Enter" });
    await flush();
    expect(onSend).not.toHaveBeenCalled();
    await act(async () => uploads.holding.get("big.txt")?.());
    await flush();
    expect(onSend).toHaveBeenCalledWith("still typing", [uploaded("big.txt")]);
  });

  it("will not send while an upload failed, until it is retried", async () => {
    uploads.failing.add("bad.txt");
    const { onSend } = render();
    chooseFiles([file("bad.txt")]);
    await flush();
    expect(chipStatus()).toEqual(["failed"]);
    type("with file");
    expect(button("Send")?.disabled).toBe(true);
    await press({ key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
    expect(alerts()).toContain(
      "An attachment failed to upload. Retry or remove it before sending.",
    );

    uploads.failing.clear();
    act(() => button("Retry upload of bad.txt")?.click());
    await flush();
    expect(chipStatus()).toEqual(["uploaded"]);
    await press({ key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("with file", [uploaded("bad.txt")]);
  });

  it("removes a chosen file and deletes its upload", async () => {
    render();
    chooseFiles([file("a.txt"), file("b.txt")]);
    await flush();
    act(() => button("Remove a.txt")?.click());
    expect(chips()).toEqual(["b.txt"]);
    await flush();
    expect(uploads.removed).toEqual(["id-a.txt"]);
  });

  it("rejects empty and oversized files", () => {
    render();
    chooseFiles([file("empty.txt", 0)]);
    expect(chips()).toEqual([]);
    expect(alerts()).toContain("Files cannot be empty and must stay under 25 MB each");
  });

  it("rejects more than ten files per message", () => {
    render();
    chooseFiles(Array.from({ length: 11 }, (_, index) => file(`${index}.txt`)));
    expect(chips()).toEqual([]);
    expect(alerts()).toContain("A message can carry at most 10 files");
  });

  it("takes pasted files instead of pasting text", () => {
    render();
    const pasted = file("clip.txt");
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { files: [pasted] } });
    act(() => {
      textarea().dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(chips()).toEqual(["clip.txt"]);
  });

  it("takes dropped files", () => {
    render();
    const form = container?.querySelector("form") as HTMLFormElement;
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", {
      value: { files: [file("dropped.txt")], types: ["Files"] },
    });
    act(() => {
      form.dispatchEvent(event);
    });
    expect(chips()).toEqual(["dropped.txt"]);
  });
});

describe("Composer action button", () => {
  const actions = () =>
    Array.from(container?.querySelectorAll("button.hub-composer-send") ?? []).map((node) =>
      node.getAttribute("aria-label"),
    );

  it("is one button that sends while the session is idle", async () => {
    const { onSend } = render();
    expect(actions()).toEqual(["Send"]);
    expect(button("Send")?.disabled).toBe(true);
    type("ready");
    act(() => button("Send")?.click());
    await flush();
    expect(onSend).toHaveBeenCalledWith("ready", []);
  });

  it("stops the running turn while there is nothing to send", () => {
    const onStop = vi.fn();
    render({ running: true, onStop, onQueue: vi.fn(async () => {}) });
    expect(actions()).toEqual(["Stop"]);
    act(() => button("Stop")?.click());
    expect(onStop).toHaveBeenCalled();
  });

  it("queues the draft instead while the turn runs", async () => {
    const onQueue = vi.fn(async () => {});
    const { onSend } = render({ running: true, onStop: vi.fn(), onQueue });
    type("next");
    expect(actions()).toEqual(["Queue message"]);
    act(() => button("Queue message")?.click());
    await flush();
    expect(onQueue).toHaveBeenCalledWith("next", []);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("sends again once the agent is waiting for input", () => {
    render({ running: true, stoppable: false, onStop: vi.fn() });
    expect(actions()).toEqual(["Send"]);
  });

  it("renders the provider's option pills when given controls", () => {
    render({
      controls: {
        provider: "claude",
        info: {
          name: "claude",
          displayName: "Claude",
          installed: true,
          authenticated: true,
          enabled: true,
          models: [{ id: "opus", name: "Opus", isDefault: true }],
          capabilities: {
            permissionModes: [{ id: "default", label: "Default" }],
            thinkingModes: [],
            slashCommands: "leading",
            contextUsage: "used",
            attachments: { maxBytes: 10, maxCount: 1 },
          },
        },
        options: {},
        onChange: () => {},
      },
    });
    const labels = Array.from(container?.querySelectorAll("button") ?? []).map(
      (node) => node.getAttribute("aria-label") ?? node.textContent,
    );
    expect(labels).toContain("Default");
    expect(labels).toContain("Opus");
  });

  it("applies the provider's attachment limits", () => {
    render({
      controls: {
        provider: "codex",
        info: {
          name: "codex",
          displayName: "Codex",
          installed: true,
          authenticated: true,
          enabled: true,
          capabilities: {
            permissionModes: [],
            thinkingModes: [],
            slashCommands: "anywhere",
            contextUsage: "remaining",
            attachments: { maxBytes: 1024 * 1024, maxCount: 1 },
          },
        },
        options: {},
        onChange: () => {},
      },
    });
    chooseFiles([file("a.txt"), file("b.txt")]);
    expect(alerts()).toContain("A message can carry at most 1 files");
  });
});

describe("Composer voice input", () => {
  type Recognition = {
    onstart: (() => void) | null;
    onresult: ((event: unknown) => void) | null;
    onend: (() => void) | null;
    onerror: ((event: unknown) => void) | null;
    start: () => void;
    stop: () => void;
    abort: () => void;
  };
  let instance: Recognition | undefined;

  beforeEach(() => {
    instance = undefined;
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = class {
      continuous = false;
      interimResults = false;
      lang = "";
      onstart: (() => void) | null = null;
      onresult: ((event: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      constructor() {
        instance = this as unknown as Recognition;
      }
      start() {
        this.onstart?.();
      }
      stop() {}
      abort() {}
    };
  });

  const speak = (transcript: string, isFinal: boolean) =>
    act(() => instance?.onresult?.({ results: [{ 0: { transcript }, isFinal }] }));

  it("hides the microphone when speech recognition is unavailable", () => {
    Reflect.deleteProperty(window, "SpeechRecognition");
    render();
    expect(button("Start voice input")).toBeNull();
  });

  it("appends final transcripts to the draft", () => {
    render();
    type("hello");
    act(() => button("Start voice input")?.click());
    speak("world", true);
    expect(textarea().value).toBe("hello world");
  });

  it("includes the in-progress transcript when sending mid-dictation", async () => {
    const { onSend } = render();
    type("draft");
    act(() => button("Start voice input")?.click());
    speak("spoken words", false);
    expect(textarea().value).toBe("draft spoken words");

    await press({ key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("draft spoken words", []);
  });
});

describe("Composer correcting a sent prompt", () => {
  const sentFile = (name: string) => ({
    id: `sent-${name}`,
    filename: name,
    mediaType: "text/plain",
    size: 0,
    url: `/api/sessions/s1/attachments/sent-${name}`,
  });
  const lastPrompt = () => ({ id: "u2", text: "第二问", attachments: [sentFile("notes.txt")] });
  function renderWith(overrides: Partial<Props>) {
    const current = { ...props(), ...overrides };
    act(() =>
      root?.render(
        <QueryClientProvider client={queryClient}>
          <Composer {...current} />
        </QueryClientProvider>,
      ),
    );
    return current;
  }
  const banner = () => container?.textContent?.includes("正在编辑上一条消息") ?? false;

  it("edits the prompt and its files in place of the draft, and Esc brings the draft back", async () => {
    const onEditEnd = vi.fn();
    render();
    type("unsent draft");
    renderWith({ editing: lastPrompt(), onEditEnd });
    expect(banner()).toBe(true);
    expect(textarea().value).toBe("第二问");
    expect(chips()).toEqual(["notes.txt"]);

    // Taking a sent file off the correction leaves its upload alone.
    act(() => button("Remove notes.txt")?.click());
    await flush();
    expect(chips()).toEqual([]);
    expect(uploads.removed).toEqual([]);
    chooseFiles([file("extra.txt")]);
    await flush();

    await press({ key: "Escape" });
    expect(onEditEnd).toHaveBeenCalledTimes(1);
    expect(textarea().value).toBe("unsent draft");
    expect(chips()).toEqual([]);
    // The file added only for the correction is deleted with it.
    expect(uploads.removed).toEqual(["id-extra.txt"]);
  });

  it("sends the correction with the files it kept, then brings the draft back", async () => {
    const onEditEnd = vi.fn();
    const { onSend } = render();
    type("unsent draft");
    renderWith({ onSend, editing: lastPrompt(), onEditEnd });
    type("改过的第二问");
    await press({ key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("改过的第二问", [
      expect.objectContaining({ id: "sent-notes.txt" }),
    ]);
    // The parent ends the mode on onEditEnd; the composer has put the draft back.
    expect(onEditEnd).toHaveBeenCalledTimes(1);
    expect(textarea().value).toBe("unsent draft");
  });

  it("stays in edit mode with the correction when sending it fails", async () => {
    const onEditEnd = vi.fn();
    const onSend = vi.fn(async () => Promise.reject(new Error("Network down")));
    render({ onSend });
    renderWith({ onSend, editing: lastPrompt(), onEditEnd });
    await press({ key: "Enter" });
    expect(onEditEnd).not.toHaveBeenCalled();
    expect(banner()).toBe(true);
    expect(textarea().value).toBe("第二问");
    expect(chips()).toEqual(["notes.txt"]);
  });
});
