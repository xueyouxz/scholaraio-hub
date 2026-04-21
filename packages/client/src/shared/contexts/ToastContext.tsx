import { type ReactNode, createContext, useCallback, useContext, useState } from "react";
import { generateUUID } from "../lib/uuid";
import { ToastContainer } from "../ui/Toast";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: string;
  message: string;
  type: "error" | "success" | "info";
  action?: ToastAction;
}

interface ToastContextValue {
  showToast: (message: string, type?: Toast["type"], action?: ToastAction) => void;
  dismissToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION_MS = 5000;
const ACTION_DURATION_MS = 7000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback<ToastContextValue["showToast"]>((message, type, action) => {
    const id = generateUUID();
    setToasts((prev) => [...prev, { id, message, type: type ?? "info", action }]);
    const timeout = action ? ACTION_DURATION_MS : DEFAULT_DURATION_MS;
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, timeout);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast, dismissToast }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}

export function useToastContext(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToastContext must be used within a ToastProvider");
  }
  return context;
}
