import type {
  ProviderInfo,
  ProviderUsageLimitWindow,
  ProviderUsageLimits,
} from "@scholaraio-hub/shared";

function formatResetTime(value?: string) {
  if (!value) return "Reset unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Reset unknown";
  return `Resets ${date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function getUsageLimitBarColor(percent: number | null) {
  if (percent === null) return "var(--color-outline-variant)";
  const progress = Math.min(1, Math.max(0, percent / 100));
  const hue = 142 - progress * 101;
  const saturation = 57 - progress * 2;
  const lightness = 30 - progress * 5;
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}

/** "pro" → "Pro": plans arrive in the provider's lower-case words. */
export function formatPlan(plan: string) {
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

/** A paid plan carries usage windows; a free login or an API key does not. */
export function isSubscribed(provider: ProviderInfo | undefined) {
  return Boolean(provider?.authenticated && provider.plan && provider.plan !== "free");
}

/** Login and plan, in one line: what the card says under the tool's name. */
export function describeProvider(provider: ProviderInfo | undefined, loading: boolean) {
  if (!provider) return loading ? "检测中…" : "当前环境未启用";
  if (provider.error) return `状态读取失败：${provider.error}`;
  if (!provider.installed) return "未找到可用的 CLI";
  if (!provider.authenticated) return "已安装，尚未登录";
  const plan = provider.plan ? `${formatPlan(provider.plan)} 订阅` : "未订阅";
  return [
    "已登录",
    provider.plan === "free" ? "Free 套餐" : plan,
    provider.user?.email,
    provider.modelsError && `模型列表读取失败：${provider.modelsError}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

function UsageLimitRow({
  label,
  window,
  note,
}: { label: string; window?: ProviderUsageLimitWindow; note?: string }) {
  const percent = window?.usedPercent === undefined ? null : Math.round(window.usedPercent);
  const width = percent === null ? 0 : Math.min(100, Math.max(0, percent));
  return (
    <span className="block px-3 py-2">
      <span className="flex items-baseline justify-between gap-4">
        <span className="text-[11px] font-medium text-on-surface">{label}</span>
        <span className="text-[11px] font-mono tabular-nums text-on-surface/70 shrink-0">
          {percent === null ? "—" : `${percent}%`}
        </span>
      </span>
      <span className="block mt-1 h-1.5 rounded-full bg-surface-container-high overflow-hidden">
        <span
          className="block h-full rounded-full transition-[width,background-color] duration-500 ease-out motion-reduce:transition-none"
          style={{ width: `${width}%`, backgroundColor: getUsageLimitBarColor(percent) }}
        />
      </span>
      <span className="block mt-1 truncate text-[10px] leading-tight text-on-surface-variant/50">
        {note ?? formatResetTime(window?.resetsAt)}
      </span>
    </span>
  );
}

/** The windows worth a row, shortest first: the 5-hour one and one weekly one. */
function pickWindows(limits: ProviderUsageLimits | null) {
  const windows = limits?.windows ?? [];
  const fiveHour = windows.find((w) => w.name === "fiveHour");
  const weekly =
    windows.find((w) => w.name === "weekly") ??
    windows.find((w) => w.name === "weeklySonnet") ??
    windows.find((w) => w.name === "weeklyOpus");
  return { fiveHour, weekly };
}

/**
 * The lower half of a tool's card: usage for a subscribed login, otherwise
 * why there is none.
 *
 * It keeps one height whatever it shows, so a status that arrives, or
 * changes, moves only the bars and never the page.
 */
export function UsageLimitBlock({
  provider,
  limits,
  loading,
}: {
  provider: ProviderInfo | undefined;
  limits: ProviderUsageLimits | null;
  loading: boolean;
}) {
  const shell = "h-[124px] border-t border-outline-variant/10";
  if (!isSubscribed(provider)) {
    const reason = !provider
      ? loading
        ? "检测中…"
        : "当前环境未启用"
      : !provider.installed || !provider.authenticated
        ? "登录后显示订阅与用量"
        : provider.plan === "free"
          ? "Free 套餐没有可显示的用量额度"
          : "未订阅套餐，按 API Key 计费，没有用量额度";
    return (
      <span className={`${shell} flex items-center justify-center px-3`}>
        <span className="text-[11px] text-on-surface-variant/60">{reason}</span>
      </span>
    );
  }
  const { fiveHour, weekly } = pickWindows(limits?.windows.length ? limits : null);
  // Nothing fetched yet: the rows stand in place, empty, until numbers arrive.
  const pending = !limits?.windows.length;
  const note = pending ? (loading ? "加载中…" : (limits?.error ?? "暂无用量数据")) : undefined;
  return (
    <span className={`${shell} block divide-y divide-outline-variant/10`}>
      {pending || fiveHour ? <UsageLimitRow label="5 hours" window={fiveHour} note={note} /> : null}
      {pending || weekly ? <UsageLimitRow label="Weekly" window={weekly} note={note} /> : null}
    </span>
  );
}
