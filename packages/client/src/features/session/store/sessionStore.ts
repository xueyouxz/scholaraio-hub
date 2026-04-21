import { create } from "zustand";
import { type SessionStateSnapshot, createEmptySessionSnapshot, mergeMessages } from "../model";

interface SessionStoreState {
  snapshot: SessionStateSnapshot;
  loading: boolean;
  loadingOlder: boolean;
  error: string;
  connected: boolean;
  setSnapshot: (
    value: SessionStateSnapshot | ((current: SessionStateSnapshot) => SessionStateSnapshot),
  ) => void;
  reset: () => void;
  setLoading: (loading: boolean) => void;
  setLoadingOlder: (loading: boolean) => void;
  setError: (error: string) => void;
  setConnected: (connected: boolean) => void;
  mergeIncomingMessage: (message: SessionStateSnapshot["messages"][number]) => void;
}

export const useSessionStore = create<SessionStoreState>()((set) => ({
  snapshot: createEmptySessionSnapshot(),
  loading: true,
  loadingOlder: false,
  error: "",
  connected: false,
  setSnapshot: (value) =>
    set((state) => ({
      snapshot: typeof value === "function" ? value(state.snapshot) : value,
    })),
  reset: () =>
    set({
      snapshot: createEmptySessionSnapshot(),
      loading: true,
      loadingOlder: false,
      error: "",
      connected: false,
    }),
  setLoading: (loading) => set({ loading }),
  setLoadingOlder: (loadingOlder) => set({ loadingOlder }),
  setError: (error) => set({ error }),
  setConnected: (connected) => set({ connected }),
  mergeIncomingMessage: (message) =>
    set((state) => ({
      snapshot: {
        ...state.snapshot,
        messages: mergeMessages(state.snapshot.messages, [message]),
      },
    })),
}));
