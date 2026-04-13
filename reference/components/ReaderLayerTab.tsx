import type React from "react";

interface ReaderLayerTabProps {
  label: string;
  active?: boolean;
}

const ReaderLayerTab: React.FC<ReaderLayerTabProps> = ({ label, active = false }) => (
  <div
    className={`px-4 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-tighter transition-all ${
      active
        ? "bg-surface-container-lowest text-primary shadow-sm border border-outline-variant/10"
        : "text-on-surface-variant hover:bg-surface-container"
    }`}
  >
    {label}
  </div>
);

export default ReaderLayerTab;
