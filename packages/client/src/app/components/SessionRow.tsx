import type { SessionSummary } from "@scholaraio-hub/shared";
import { useEffect, useRef } from "react";
import { NavLink } from "react-router-dom";
import { sessionUrl } from "../../core/sessions";
import { ProviderWatermark } from "../../shared/ui/ProviderLogo";

const PROVIDER_NAMES = { claude: "Claude Code", codex: "Codex" } as const;

/** How long ago, in the words the lists use. */
export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}天前`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}周前`;
  return `${Math.floor(days / 30)}月前`;
}

/**
 * One session in a list: which agent keeps it (its mark, faint behind the
 * row), its title, whether it runs here or elsewhere, and when it last changed.
 */
export function SessionRow({
  session,
  renaming = false,
  onRename,
  onCancelRename,
  onMenu,
  onOpen,
}: {
  session: SessionSummary;
  renaming?: boolean;
  onRename?: (title: string) => void;
  onCancelRename?: () => void;
  onMenu?: (x: number, y: number) => void;
  onOpen?: () => void;
}) {
  // The user just chose to rename it: its name field takes the focus.
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (renaming) input.current?.focus();
  }, [renaming]);
  const title = session.title || "未命名会话";
  const agent = PROVIDER_NAMES[session.provider];
  if (renaming)
    return (
      <input
        ref={input}
        aria-label="会话名称"
        defaultValue={title}
        maxLength={200}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={(event) => onRename?.(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") onRename?.(event.currentTarget.value);
          else if (event.key === "Escape") onCancelRename?.();
        }}
        className="w-full rounded-lg border border-primary/40 bg-surface-container-lowest px-2.5 py-1 text-[12px] text-on-surface outline-none"
      />
    );
  return (
    <NavLink
      to={sessionUrl(session.id)}
      onClick={onOpen}
      title={`${title}\n${agent} · ${session.cwd}`}
      className={({ isActive }) =>
        `group relative isolate flex items-center gap-2 w-full overflow-hidden rounded-lg pl-2.5 pr-2 py-1.5 text-left transition-colors ${isActive ? "bg-surface-container-high text-primary" : "text-on-surface hover:bg-surface-container"}`
      }
      style={{ contentVisibility: "auto", containIntrinsicSize: "auto 28px" }}
      onContextMenu={(event) => {
        if (!onMenu) return;
        event.preventDefault();
        onMenu(event.clientX, event.clientY);
      }}
    >
      <ProviderWatermark
        provider={session.provider}
        className="absolute left-0.5 top-1/2 h-8 w-8 -translate-y-1/2 opacity-[0.12]"
      />
      <span className="sr-only">{agent}：</span>
      <span className="line-clamp-1 text-[12px] min-w-0 flex-1">{title}</span>
      <span className="flex items-center gap-1.5 shrink-0">
        {session.state ? (
          <span
            role="img"
            aria-label={session.state === "waiting-input" ? "等待回复" : "进行中"}
            className={`w-1.5 h-1.5 rounded-full animate-pulse ${session.state === "waiting-input" ? "bg-tertiary" : "bg-primary"}`}
          />
        ) : session.external ? (
          <span
            title="另一个程序（如终端里的 CLI）正在使用这个会话"
            className="text-[9px] font-mono font-bold px-1 py-px rounded leading-none uppercase text-on-surface-variant bg-surface-container"
          >
            ext
          </span>
        ) : null}
        <span
          className="text-[9.5px] text-on-surface-variant/60 whitespace-nowrap"
          title={new Date(session.updatedAt).toLocaleString()}
        >
          {relativeTime(session.updatedAt)}
        </span>
      </span>
    </NavLink>
  );
}
