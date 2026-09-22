import type { SlashCommand } from "@scholaraio-hub/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ComponentProps, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const commands = vi.hoisted(() => ({
  list: [] as SlashCommand[],
  calls: [] as Array<{ provider: string; sessionId?: string }>,
}));

vi.mock("../../../../../core/library", () => ({
  sessionApi: {
    commands: async (provider: string, sessionId?: string) => {
      commands.calls.push({ provider, sessionId });
      return { commands: commands.list };
    },
  },
}));

import { Composer, readComposerDraft } from "../Composer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no layout; the suggestion list scrolls its active option into view.
Element.prototype.scrollIntoView ??= () => {};

type Props = ComponentProps<typeof Composer>;

let root: Root | undefined;
let container: HTMLDivElement | undefined;
let queryClient: QueryClient;

beforeEach(() => {
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

function file(name: string, size = 3) {
  return new File(["x".repeat(size)], name, { type: "text/plain" });
}

function chooseFiles(files: File[]) {
  const input = container?.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, "files", { value: files, configurable: true });
  act(() => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

const chips = () =>
  Array.from(container?.querySelectorAll('[aria-label="附件"] span') ?? []).map(
    (node) => node.textContent,
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
    expect(button("发送")?.disabled).toBe(true);
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
    render({ onSend: vi.fn(async () => Promise.reject(new Error("网络断开"))) });
    type("hello");
    await press({ key: "Enter" });
    expect(textarea().value).toBe("hello");
    expect(alerts()).toContain("网络断开");
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

  it("merges extra commands without duplicating names", async () => {
    render({
      extraCommands: [
        { name: "review", description: "duplicate" },
        { name: "summarize", description: "Summarize papers", source: "research" },
      ],
    });
    await flush();
    type("/");
    expect(suggestions().map((item) => item.text)).toEqual([
      "/attach",
      "/review",
      "/research <q>",
      "/commit",
      "/summarize",
    ]);
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
    expect(container?.querySelector('[role="menu"]')?.textContent).toContain("Opus (默认)");
    expect(textarea().value).toBe("");
  });
});

describe("Composer attachments", () => {
  it("adds chosen files and sends them with the message", async () => {
    const { onSend } = render();
    const notes = file("notes.txt");
    chooseFiles([notes]);
    expect(chips()).toEqual(["notes.txt"]);

    await press({ key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("", [notes]);
    expect(chips()).toEqual([]);
  });

  it("removes a chosen file", () => {
    render();
    chooseFiles([file("a.txt"), file("b.txt")]);
    act(() => button("移除 a.txt")?.click());
    expect(chips()).toEqual(["b.txt"]);
  });

  it("rejects empty and oversized files", () => {
    render();
    chooseFiles([file("empty.txt", 0)]);
    expect(chips()).toEqual([]);
    expect(alerts()).toContain("附件不能为空，且单个文件不能超过 25 MB");
  });

  it("rejects more than ten files per message", () => {
    render();
    chooseFiles(Array.from({ length: 11 }, (_, index) => file(`${index}.txt`)));
    expect(chips()).toEqual([]);
    expect(alerts()).toContain("每条消息最多添加 10 个附件");
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

describe("Composer send/stop actions", () => {
  it("turns the primary action into Stop while running with no draft", () => {
    const onStop = vi.fn();
    render({ running: true, onStop, onQueue: vi.fn(async () => {}) });
    act(() => button("停止")?.click());
    expect(onStop).toHaveBeenCalled();
    expect(button("发送")).toBeNull();
  });

  it("shows Send, Queue and a secondary Stop while running with a draft", () => {
    render({ running: true, onStop: vi.fn(), onQueue: vi.fn(async () => {}) });
    type("next");
    expect(button("发送")).not.toBeNull();
    expect(button("加入队列")).not.toBeNull();
    expect(button("停止")).not.toBeNull();
  });

  it("hides Stop once the agent is waiting for input", () => {
    render({ running: true, thinking: false, onStop: vi.fn(), onQueue: vi.fn(async () => {}) });
    expect(button("停止")).toBeNull();
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
      (node) => node.textContent,
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
    expect(alerts()).toContain("每条消息最多添加 1 个附件");
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
