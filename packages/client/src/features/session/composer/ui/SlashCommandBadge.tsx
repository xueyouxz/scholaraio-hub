import type { SlashCommand } from "@scholaraio-hub/shared";

interface Props {
  token: string;
  command: SlashCommand;
}

export function SlashCommandBadge({ token, command }: Props) {
  return (
    <div className="px-4 pt-3">
      <div
        className="inline-flex max-w-full items-center rounded-full border border-outline-variant/20 px-2.5 py-1 font-mono text-[11px] font-bold text-primary"
        title={command.description || undefined}
      >
        <span className="truncate">{token}</span>
      </div>
    </div>
  );
}
