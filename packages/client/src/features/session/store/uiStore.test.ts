import { beforeEach, describe, expect, it } from "vitest";
import { useUiStore } from "./uiStore";

describe("uiStore", () => {
  beforeEach(() => {
    useUiStore.setState({
      sidebarCollapsed: false,
      thinkingExpanded: false,
      activeModal: null,
    });
  });

  it("toggles the sidebar collapsed flag", () => {
    expect(useUiStore.getState().sidebarCollapsed).toBe(false);
    useUiStore.getState().toggleSidebar();
    expect(useUiStore.getState().sidebarCollapsed).toBe(true);
    useUiStore.getState().toggleSidebar();
    expect(useUiStore.getState().sidebarCollapsed).toBe(false);
  });

  it("opens and closes modals by id", () => {
    useUiStore.getState().openModal("settings");
    expect(useUiStore.getState().activeModal).toBe("settings");
    useUiStore.getState().closeModal();
    expect(useUiStore.getState().activeModal).toBeNull();
  });

  it("toggles thinking expansion", () => {
    expect(useUiStore.getState().thinkingExpanded).toBe(false);
    useUiStore.getState().toggleThinkingExpanded();
    expect(useUiStore.getState().thinkingExpanded).toBe(true);
  });
});
