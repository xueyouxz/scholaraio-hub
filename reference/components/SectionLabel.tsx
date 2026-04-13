import type React from "react";

interface SectionLabelProps {
  label: string;
  accent?: "primary" | "default";
}

const SectionLabel: React.FC<SectionLabelProps> = ({ label, accent = "default" }) => (
  <p
    className={
      accent === "primary"
        ? "font-mono text-[10px] font-bold uppercase tracking-widest text-primary"
        : "font-mono text-[10px] font-bold uppercase tracking-widest text-on-surface-variant"
    }
  >
    {label}
  </p>
);

export default SectionLabel;
