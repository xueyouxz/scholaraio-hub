import type { InputRequest } from "@scholaraio-hub/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { InputRequestPrompt } from "../InputRequestPrompt";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});

function render(request: InputRequest, placement: "inline" | "floating" = "inline") {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      <QueryClientProvider client={new QueryClient()}>
        <InputRequestPrompt
          request={request}
          sessionId="s"
          placement={placement}
          onDone={() => {}}
        />
      </QueryClientProvider>,
    ),
  );
  return container;
}

const request = (toolName: string, toolInput: unknown): InputRequest => ({
  id: "r",
  sessionId: "s",
  type: "tool-approval",
  prompt: `Allow ${toolName}?`,
  toolName,
  toolInput,
  timestamp: new Date().toISOString(),
});

const ask = (secret: boolean) =>
  request("AskUserQuestion", {
    questions: [
      { question: "API token?", options: [{ label: "none" }], ...(secret ? { secret: true } : {}) },
    ],
  });

const buttons = (view: HTMLElement) =>
  [...view.querySelectorAll("button")].map((button) => button.textContent);

describe("InputRequestPrompt questions", () => {
  it("masks a secret answer and offers no choices next to it", () => {
    const view = render(ask(true));
    expect(view.querySelector("input")?.type).toBe("password");
    expect(view.querySelector(".inline-option")).toBeNull();
  });

  it("offers ordinary choices and submits only once every question is answered", () => {
    const view = render(ask(false));
    expect(view.querySelector("input")?.type).toBe("text");
    const submit = [...view.querySelectorAll("button")].find((b) => b.textContent === "Submit");
    expect(submit?.disabled).toBe(true);
    act(() => (view.querySelector(".inline-option") as HTMLButtonElement).click());
    expect(submit?.disabled).toBe(false);
  });
});

describe("InputRequestPrompt permissions", () => {
  it("offers to accept edits only for a call that edits files", () => {
    expect(buttons(render(request("Write", { file_path: "a.txt", content: "" })))).toEqual([
      "Allow",
      "Allow and accept edits",
      "Deny",
    ]);
    act(() => root?.unmount());
    expect(buttons(render(request("Bash", { command: "ls" })))).toEqual(["Allow", "Deny"]);
  });

  it("asks the same way when floating, naming the call it is about", () => {
    const view = render(request("Bash", { command: "ls -la" }), "floating");
    expect(view.querySelector('[role="alert"]')?.textContent).toContain("Bash ls -la");
    expect(buttons(view)).toEqual(["Allow", "Deny"]);
  });

  it("shows the plan it asks to approve", () => {
    const view = render(request("ExitPlanMode", { plan: "1. Read the paper" }), "floating");
    expect(view.textContent).toContain("Read the paper");
    expect(buttons(view)).toEqual([
      "Yes, and auto-accept edits",
      "Yes, approve each edit",
      "No, keep planning",
    ]);
  });
});
