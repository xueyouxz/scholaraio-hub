import type { InputRequest } from "@scholaraio-hub/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { InputRequestPanel } from "../InputRequestPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});

function render(request: InputRequest) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      <QueryClientProvider client={new QueryClient()}>
        <InputRequestPanel request={request} sessionId="s" onDone={() => {}} />
      </QueryClientProvider>,
    ),
  );
  return container;
}

const ask = (secret: boolean): InputRequest => ({
  id: "r",
  sessionId: "s",
  type: "tool-approval",
  prompt: "Allow AskUserQuestion?",
  toolName: "AskUserQuestion",
  toolInput: {
    questions: [
      { question: "API token?", options: [{ label: "none" }], ...(secret ? { secret: true } : {}) },
    ],
  },
  timestamp: new Date().toISOString(),
});

describe("InputRequestPanel questions", () => {
  it("masks a secret answer and offers no suggestions next to it", () => {
    const view = render(ask(true));
    const input = view.querySelector("input");
    expect(input?.type).toBe("password");
    expect(input?.getAttribute("list")).toBeNull();
    expect(view.querySelector("datalist")).toBeNull();
  });

  it("keeps ordinary questions as text with suggestions", () => {
    const view = render(ask(false));
    const input = view.querySelector("input");
    expect(input?.type).toBe("text");
    expect(view.querySelector("datalist option")?.getAttribute("value")).toBe("none");
  });
});
