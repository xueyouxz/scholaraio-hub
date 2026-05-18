interface SectionLabelProps {
  label: string;
  accent?: "primary" | "default";
}

export function SectionLabel({ label, accent = "default" }: SectionLabelProps) {
  return (
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
}
