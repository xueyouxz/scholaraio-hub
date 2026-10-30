import type { ProviderName } from "@scholaraio-hub/shared";

/** Each agent's own mark, as shipped in public/icons. */
const LOGOS: Record<ProviderName, string> = {
  claude: "/icons/claudecode-color.svg",
  codex: "/icons/codex-color.svg",
};

/** The same marks without their backgrounds, in one colour, for drawing in the agent's colour. */
const MARKS: Record<ProviderName, string> = {
  claude: "/icons/claudecode-mark.svg",
  codex: "/icons/codex-mark.svg",
};

export function ProviderLogo({ provider, size = 14 }: { provider: ProviderName; size?: number }) {
  return (
    <img
      src={LOGOS[provider]}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      className="shrink-0 rounded-[3px]"
    />
  );
}

/**
 * An agent's mark as a faint backdrop, in the agent's colour. `className`
 * places and sizes it; the box it sits in should `isolate`, so the mark stays
 * behind the text but above the box's own background.
 */
export function ProviderWatermark({
  provider,
  className,
}: {
  provider: ProviderName;
  className: string;
}) {
  const mask = `url(${MARKS[provider]}) center / contain no-repeat`;
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none -z-10 ${className}`}
      style={{ backgroundColor: `var(--provider-${provider})`, mask, WebkitMask: mask }}
    />
  );
}
