import type { ProviderName } from "@scholaraio-hub/shared";

/** Each agent's own mark, as shipped in public/icons. */
const LOGOS: Record<ProviderName, string> = {
  claude: "/icons/claudecode-color.svg",
  codex: "/icons/codex-color.svg",
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
