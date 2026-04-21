import type { PermissionMode, ThinkingOption } from "@scholaraio-hub/shared";
import { create } from "zustand";

export interface ComposerAttachment {
  file: File;
  uploadProgress?: number;
}

interface ComposerStoreState {
  message: string;
  thinking: ThinkingOption;
  permissionMode: PermissionMode;
  isHeld: boolean;
  attachments: ComposerAttachment[];
  selectedModel?: string;
  busy: boolean;
  sendError: string;
  setMessage: (value: string) => void;
  setThinking: (value: ThinkingOption) => void;
  setPermissionMode: (value: PermissionMode) => void;
  toggleHold: () => void;
  setAttachments: (
    value: ComposerAttachment[] | ((current: ComposerAttachment[]) => ComposerAttachment[]),
  ) => void;
  addFiles: (files: File[]) => void;
  removeAttachment: (index: number) => void;
  setSelectedModel: (model?: string) => void;
  setBusy: (busy: boolean) => void;
  setSendError: (error: string) => void;
  reset: () => void;
}

const INITIAL: Omit<
  ComposerStoreState,
  | "setMessage"
  | "setThinking"
  | "setPermissionMode"
  | "toggleHold"
  | "setAttachments"
  | "addFiles"
  | "removeAttachment"
  | "setSelectedModel"
  | "setBusy"
  | "setSendError"
  | "reset"
> = {
  message: "",
  thinking: "auto",
  permissionMode: "default",
  isHeld: false,
  attachments: [],
  selectedModel: undefined,
  busy: false,
  sendError: "",
};

export const useComposerStore = create<ComposerStoreState>()((set) => ({
  ...INITIAL,
  setMessage: (message) => set({ message }),
  setThinking: (thinking) => set({ thinking }),
  setPermissionMode: (permissionMode) => set({ permissionMode }),
  toggleHold: () => set((state) => ({ isHeld: !state.isHeld })),
  setAttachments: (value) =>
    set((state) => ({
      attachments: typeof value === "function" ? value(state.attachments) : value,
    })),
  addFiles: (files) =>
    set((state) => ({
      attachments: [...state.attachments, ...files.map((file) => ({ file }))],
    })),
  removeAttachment: (index) =>
    set((state) => ({
      attachments: state.attachments.filter((_, i) => i !== index),
    })),
  setSelectedModel: (selectedModel) => set({ selectedModel }),
  setBusy: (busy) => set({ busy }),
  setSendError: (sendError) => set({ sendError }),
  reset: () => set({ ...INITIAL }),
}));
