import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "../ErrorBoundary";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Item({ fail }: { fail: boolean }) {
  if (fail) throw new Error("bad input");
  return <span>ok</span>;
}

describe("ErrorBoundary", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement("div");
    root = createRoot(container);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    act(() => root.unmount());
    vi.restoreAllMocks();
  });

  const render = (fail: boolean, resetKey: unknown) =>
    act(() =>
      root.render(
        <>
          <ErrorBoundary fallback={(error) => <em>{error.message}</em>} resetKey={resetKey}>
            <Item fail={fail} />
          </ErrorBoundary>
          <span>sibling</span>
        </>,
      ),
    );

  it("replaces only the failing subtree", () => {
    render(true, 1);
    expect(container.textContent).toBe("bad inputsibling");
  });

  it("stays on the fallback until the reset key changes, then retries", () => {
    render(true, 1);
    render(false, 1);
    expect(container.textContent).toBe("bad inputsibling");
    render(false, 2);
    expect(container.textContent).toBe("oksibling");
  });
});
