import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import type { Toast as ToastType } from "../contexts/ToastContext";

interface Props {
  toasts: ToastType[];
  onDismiss: (id: string) => void;
}

const TYPE_STYLES: Record<ToastType["type"], string> = {
  error: "bg-error-container/95 text-on-error-container border-error/30",
  success: "bg-primary-container/95 text-on-primary-container border-primary/30",
  info: "bg-surface-container-high/95 text-on-surface border-outline-variant/30",
};

export function ToastContainer({ toasts, onDismiss }: Props) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => {
        const Icon =
          toast.type === "error" ? XCircle : toast.type === "success" ? CheckCircle2 : Info;
        return (
          <div
            key={toast.id}
            className={`flex items-start gap-3 px-4 py-3 rounded-2xl border shadow-md backdrop-blur-md ${TYPE_STYLES[toast.type]}`}
            role="alert"
          >
            <Icon className="w-4 h-4 shrink-0 mt-0.5" />
            <p className="flex-1 text-sm leading-snug m-0">{toast.message}</p>
            {toast.action ? (
              <button
                type="button"
                onClick={() => {
                  toast.action?.onClick();
                  onDismiss(toast.id);
                }}
                className="text-xs font-medium underline underline-offset-2 !p-0 !border-0 !bg-transparent hover:![transform:none] cursor-pointer"
              >
                {toast.action.label}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              aria-label="Dismiss"
              className="!p-0 !border-0 !bg-transparent hover:![transform:none] cursor-pointer opacity-60 hover:opacity-100"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
