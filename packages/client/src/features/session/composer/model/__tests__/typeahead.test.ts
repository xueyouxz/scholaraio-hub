import { describe, expect, it, vi } from "vitest";
import { type Typeahead, typeaheadKey } from "../typeahead";

function menu(items: string[], activeIndex = 0, open = true) {
  const state: Typeahead<string> & { index: number } = {
    open,
    items,
    activeIndex,
    index: activeIndex,
    setActiveIndex: (next) => {
      state.index = typeof next === "function" ? next(state.index) : next;
    },
    dismiss: vi.fn(),
  };
  return state;
}

const press = (key: string, modifiers: { shiftKey?: boolean; ctrlKey?: boolean } = {}) => ({
  key,
  shiftKey: false,
  ctrlKey: false,
  ...modifiers,
});

describe("typeaheadKey", () => {
  it("moves through the items with the arrows, wrapping, and jumps with Home and End", () => {
    const state = menu(["a", "b", "c"]);
    expect(typeaheadKey(press("ArrowUp"), state, vi.fn())).toBe(true);
    expect(state.index).toBe(2);
    typeaheadKey(press("ArrowDown"), state, vi.fn());
    expect(state.index).toBe(0);
    typeaheadKey(press("End"), state, vi.fn());
    expect(state.index).toBe(2);
    typeaheadKey(press("Home"), state, vi.fn());
    expect(state.index).toBe(0);
  });

  it("picks the active item with Enter or Tab, but leaves Shift+Enter to the textarea", () => {
    const pick = vi.fn();
    expect(typeaheadKey(press("Enter"), menu(["a", "b"], 1), pick)).toBe(true);
    expect(typeaheadKey(press("Tab"), menu(["a", "b"], 0), pick)).toBe(true);
    expect(pick.mock.calls).toEqual([["b"], ["a"]]);
    expect(typeaheadKey(press("Enter", { shiftKey: true }), menu(["a"]), pick)).toBe(false);
  });

  it("closes on Escape even with nothing to pick", () => {
    const state = menu([]);
    expect(typeaheadKey(press("Escape"), state, vi.fn())).toBe(true);
    expect(state.dismiss).toHaveBeenCalled();
    expect(typeaheadKey(press("Enter"), state, vi.fn())).toBe(false);
  });

  it("takes no keys while closed", () => {
    const state = menu(["a"], 0, false);
    expect(typeaheadKey(press("Escape"), state, vi.fn())).toBe(false);
    expect(typeaheadKey(press("Enter"), state, vi.fn())).toBe(false);
  });
});
