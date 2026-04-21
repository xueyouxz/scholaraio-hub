import { create } from "zustand";

interface UiStoreState {
  sidebarCollapsed: boolean;
  thinkingExpanded: boolean;
  activeModal: string | null;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  setThinkingExpanded: (expanded: boolean) => void;
  toggleThinkingExpanded: () => void;
  openModal: (id: string) => void;
  closeModal: () => void;
}

export const useUiStore = create<UiStoreState>()((set) => ({
  sidebarCollapsed: false,
  thinkingExpanded: false,
  activeModal: null,
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setThinkingExpanded: (thinkingExpanded) => set({ thinkingExpanded }),
  toggleThinkingExpanded: () => set((state) => ({ thinkingExpanded: !state.thinkingExpanded })),
  openModal: (id) => set({ activeModal: id }),
  closeModal: () => set({ activeModal: null }),
}));
