import { act, useRef } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDismiss } from "../useDismiss";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Popover({ open, onDismiss }: { open: boolean; onDismiss: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const portalled = useRef<HTMLDivElement>(null);
  useDismiss(open, onDismiss, box, portalled);
  return (
    <>
      <div ref={box} id="box" />
      <div ref={portalled} id="menu" />
      <div id="outside" />
    </>
  );
}

const press = (id: string) =>
  document.getElementById(id)?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
const key = (name: string) =>
  document.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));

describe("useDismiss", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("dismisses on a press outside every given element, and on Escape", () => {
    const onDismiss = vi.fn();
    act(() => root.render(<Popover open onDismiss={onDismiss} />));
    press("box");
    press("menu");
    key("Enter");
    expect(onDismiss).not.toHaveBeenCalled();
    press("outside");
    key("Escape");
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });

  it("listens only while open", () => {
    const onDismiss = vi.fn();
    act(() => root.render(<Popover open={false} onDismiss={onDismiss} />));
    press("outside");
    act(() => root.render(<Popover open onDismiss={onDismiss} />));
    act(() => root.render(<Popover open={false} onDismiss={onDismiss} />));
    press("outside");
    key("Escape");
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
