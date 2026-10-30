import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResizeHandle } from "../ResizeHandle";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ResizeHandle", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    // jsdom has no pointer capture; frames run at once.
    HTMLElement.prototype.setPointerCapture = () => {};
    vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => {
      run(0);
      return 1;
    });
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const render = (grow: "left" | "right") => {
    const onResize = vi.fn();
    act(() =>
      root.render(
        <ResizeHandle
          label="edge"
          width={300}
          grow={grow}
          step={10}
          onResize={onResize}
          className=""
        />,
      ),
    );
    return { onResize, handle: container.querySelector('[role="separator"]') as HTMLElement };
  };
  const key = (handle: HTMLElement, name: string) =>
    act(() => {
      handle.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));
    });
  const pointer = (handle: HTMLElement, type: string, clientX: number) =>
    act(() => {
      handle.dispatchEvent(new MouseEvent(type, { clientX, bubbles: true }));
    });

  it("widens with the arrow pointing the way it grows", () => {
    const right = render("right");
    key(right.handle, "ArrowRight");
    key(right.handle, "ArrowLeft");
    expect(right.onResize.mock.calls).toEqual([
      [310, true],
      [290, true],
    ]);
    const left = render("left");
    key(left.handle, "ArrowLeft");
    expect(left.onResize).toHaveBeenLastCalledWith(310, true);
  });

  it("follows a drag by its distance, and reports the end as done", () => {
    const { onResize, handle } = render("left");
    pointer(handle, "pointerdown", 500);
    pointer(handle, "pointermove", 450);
    pointer(handle, "pointerup", 440);
    expect(onResize.mock.calls).toEqual([
      [350, false],
      [360, true],
    ]);
    expect(document.body.style.cursor).toBe("");
  });
});
