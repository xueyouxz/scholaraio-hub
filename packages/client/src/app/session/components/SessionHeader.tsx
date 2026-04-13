import { PanelLeftOpen } from "lucide-react";

interface SessionHeaderProps {
  title: string;
  onToggleSidebar: () => void;
}

export function SessionHeader({ title, onToggleSidebar }: SessionHeaderProps) {
  return (
    <header className="flex items-center gap-3 py-3 mb-2">
      <button
        type="button"
        onClick={onToggleSidebar}
        className="flex items-center justify-center w-9 h-9 rounded-xl text-on-surface-variant hover:bg-surface-container border-0 bg-transparent cursor-pointer transition-colors"
        aria-label="Toggle sidebar"
      >
        <PanelLeftOpen className="w-5 h-5" />
      </button>
      <h1 className="font-serif text-xl font-bold text-primary leading-none truncate min-w-0">
        {title}
      </h1>
    </header>
  );
}
