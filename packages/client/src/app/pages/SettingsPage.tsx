import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowDownToLine,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  HardDrive,
  Layers,
  Loader2,
  RefreshCw,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  type FsEntry,
  type HealthCheckResult,
  type HealthLevel,
  type ScholarConfig,
  api,
  browseFsDirectory,
  scholar,
} from "../../core/api";
import { queryKeys } from "../../core/queryKeys";
import type { ProviderInfo, ProviderUsageLimits } from "../../core/types";
import { usePageTitle, useProjectScope } from "../components/NavigationLayout";

// ─── Types ────────────────────────────────────────────────────────────────────

type ProviderGroup = "claude" | "codex";
type CheckStatus = "idle" | "checking" | "ok" | "degraded" | "error";
type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

// ─── Agent helpers ────────────────────────────────────────────────────────────

const CLAUDE_PROVIDERS = ["claude", "claude-ollama"];
const CODEX_PROVIDERS = ["codex", "codex-oss"];
const AGENT_CONFIG = {
  claude: { name: "Claude Code", icon: "/icons/claudecode-color.svg" },
  codex: { name: "Codex", icon: "/icons/codex-color.svg" },
} as const;

function isGroupEnabled(providers: ProviderInfo[], group: ProviderGroup) {
  const names = group === "claude" ? CLAUDE_PROVIDERS : CODEX_PROVIDERS;
  return providers.some((p) => names.includes(p.name) && p.enabled);
}
function getGroupEmail(providers: ProviderInfo[], group: ProviderGroup) {
  const names = group === "claude" ? CLAUDE_PROVIDERS : CODEX_PROVIDERS;
  return providers.find((p) => names.includes(p.name) && p.enabled)?.user?.email ?? null;
}
function getGroupUsageLimits(usageLimits: ProviderUsageLimits[], group: ProviderGroup) {
  const names = group === "claude" ? CLAUDE_PROVIDERS : CODEX_PROVIDERS;
  return usageLimits.find((item) => names.includes(item.provider)) ?? null;
}
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

// ─── Hooks ────────────────────────────────────────────────────────────────────

function usePatchConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: DeepPartial<ScholarConfig>) => scholar.patchConfig(patch),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.scholar.config(), data);
    },
  });
}

function computeCheckStatus(levels: HealthLevel[]): CheckStatus {
  const active = levels.filter((l) => l.status !== "skip");
  if (active.length === 0) return "ok";
  const failed = active.filter((l) => l.status === "fail");
  if (failed.length === 0) return "ok";
  return failed[0]?.level === 3 ? "degraded" : "error";
}

function useHealthCheck(scope: string) {
  const [status, setStatus] = useState<CheckStatus>("idle");
  const [levels, setLevels] = useState<HealthLevel[]>([]);
  const [detailOpen, setDetailOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runCheck = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus("checking");
    try {
      const result = await scholar.healthCheck(scope, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setLevels(result.levels);
      setStatus(computeCheckStatus(result.levels));
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setStatus("error");
      setLevels([]);
    }
  }, [scope]);

  useEffect(() => {
    runCheck();
    return () => {
      abortRef.current?.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [runCheck]);

  const triggerDebounced = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(runCheck, 1500);
  }, [runCheck]);

  const toggleDetail = useCallback(() => setDetailOpen((v) => !v), []);

  return { status, levels, detailOpen, toggleDetail, recheck: runCheck, triggerDebounced };
}

// ─── Small UI pieces ──────────────────────────────────────────────────────────

function SectionLabel({ label }: { label: string }) {
  return (
    <p className="text-[10px] font-mono uppercase tracking-[0.24em] text-on-surface-variant/60 mb-1.5">
      {label}
    </p>
  );
}

function UsageLimitRow({
  label,
  usedPercent,
  resetsAt,
}: { label: string; usedPercent?: number; resetsAt?: string }) {
  const percent = usedPercent === undefined ? null : Math.round(usedPercent);
  const width = percent === null ? 0 : Math.min(100, Math.max(0, percent));
  const barColor = getUsageLimitBarColor(percent);
  return (
    <span className="block px-4 pt-1.5 pb-1.5 first:pt-2 last:pb-3">
      <span className="flex items-center justify-between gap-4">
        <span className="block min-w-0">
          <span className="text-[12px] font-medium text-on-surface">{label}</span>
          <span className="block text-[10px] text-on-surface-variant/50 mt-0.5">
            {formatResetTime(resetsAt)}
          </span>
        </span>
        <span className="text-[11px] font-mono text-on-surface/70 shrink-0">
          {percent === null ? "—" : `${percent}%`}
        </span>
      </span>
      <span className="block mt-1.5 h-1 rounded-full bg-surface-container-high overflow-hidden">
        <span
          className="block h-full rounded-full transition-[width,background-color] duration-500 ease-out"
          style={{ width: `${width}%`, backgroundColor: barColor }}
        />
      </span>
    </span>
  );
}

function UsageLimitBlock({
  limits,
  loading,
}: { limits: ProviderUsageLimits | null; loading: boolean }) {
  const [lastAvailableLimits, setLastAvailableLimits] = useState<ProviderUsageLimits | null>(null);

  useEffect(() => {
    if (limits?.available) {
      setLastAvailableLimits(limits);
    }
  }, [limits]);

  const displayLimits = limits?.available ? limits : lastAvailableLimits;
  const fiveHour = displayLimits?.windows.find((w) => w.name === "fiveHour");
  const weekly =
    displayLimits?.windows.find((w) => w.name === "weekly") ??
    displayLimits?.windows.find((w) => w.name === "weeklySonnet") ??
    displayLimits?.windows.find((w) => w.name === "weeklyOpus");
  return (
    <span className="block border-t border-outline-variant/10">
      {displayLimits ? (
        <span className="block divide-y divide-outline-variant/10">
          <UsageLimitRow
            label="5 hours"
            usedPercent={fiveHour?.usedPercent}
            resetsAt={fiveHour?.resetsAt}
          />
          <UsageLimitRow
            label="Weekly"
            usedPercent={weekly?.usedPercent}
            resetsAt={weekly?.resetsAt}
          />
        </span>
      ) : (
        <span className="block px-4 pt-2 pb-3 text-[11px] text-on-surface-variant/50">
          {loading ? "Loading…" : (limits?.error ?? "No usage limit data has been reported yet.")}
        </span>
      )}
    </span>
  );
}

// ─── Health check UI ──────────────────────────────────────────────────────────

function StatusDot({ status, onClick }: { status: CheckStatus; onClick: () => void }) {
  const base = "shrink-0 cursor-pointer transition-opacity hover:opacity-80";
  if (status === "idle")
    return (
      <button type="button" onClick={onClick} className={base} title="检查连接状态">
        <span className="block w-1.5 h-1.5 rounded-full bg-on-surface-variant/25" />
      </button>
    );
  if (status === "checking")
    return (
      <span className={base} title="检查中…">
        <Loader2 className="w-3 h-3 text-on-surface-variant/40 animate-spin" />
      </span>
    );
  if (status === "ok")
    return (
      <button type="button" onClick={onClick} className={base} title="连接正常">
        <CheckCircle2 className="w-3 h-3 text-primary" />
      </button>
    );
  if (status === "degraded")
    return (
      <button type="button" onClick={onClick} className={base} title="连接但鉴权失败">
        <TriangleAlert className="w-3 h-3 text-yellow-500" />
      </button>
    );
  return (
    <button type="button" onClick={onClick} className={base} title="连接失败">
      <XCircle className="w-3 h-3 text-error" />
    </button>
  );
}

function HealthDetailPanel({
  levels,
  onRecheck,
}: { levels: HealthLevel[]; onRecheck: () => void }) {
  const statusIcon = (s: "ok" | "fail" | "skip") => {
    if (s === "ok") return <CheckCircle2 className="w-3 h-3 text-primary shrink-0" />;
    if (s === "fail") return <XCircle className="w-3 h-3 text-error shrink-0" />;
    return <span className="w-3 h-3 shrink-0 block rounded-full bg-on-surface-variant/20" />;
  };
  return (
    <div className="mx-4 mb-3 rounded-lg border border-outline-variant/15 bg-surface-container overflow-hidden">
      <div className="divide-y divide-outline-variant/10">
        {levels.map((lv) => (
          <div key={lv.level} className="flex items-start gap-2 px-3 py-2">
            {statusIcon(lv.status)}
            <div className="min-w-0 flex-1">
              <span className="text-[11px] font-medium text-on-surface">{lv.label}</span>
              {lv.detail && (
                <p className="text-[10px] text-on-surface-variant/60 mt-0.5 font-mono">
                  {lv.detail}
                </p>
              )}
            </div>
            <span
              className={`text-[9px] font-mono uppercase tracking-wide shrink-0 ${
                lv.status === "ok"
                  ? "text-primary"
                  : lv.status === "fail"
                    ? "text-error"
                    : "text-on-surface-variant/40"
              }`}
            >
              {lv.status}
            </span>
          </div>
        ))}
      </div>
      <div className="px-3 py-1.5 border-t border-outline-variant/10">
        <button
          type="button"
          onClick={onRecheck}
          className="flex items-center gap-1 text-[10px] text-on-surface-variant/50 hover:text-primary transition-colors"
        >
          <RefreshCw className="w-2.5 h-2.5" />
          重新检查
        </button>
      </div>
    </div>
  );
}

// ─── CollapsibleSection ───────────────────────────────────────────────────────

function CollapsibleSection({
  icon: Icon,
  title,
  summary,
  children,
  defaultOpen = false,
  healthStatus,
  onHealthIconClick,
}: {
  icon: React.ElementType;
  title: string;
  summary?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  healthStatus?: CheckStatus;
  onHealthIconClick?: () => void;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-outline-variant/10 last:border-b-0">
      <div className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-surface-container/50 transition-colors text-left">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="min-w-0 flex flex-1 items-center gap-2.5 text-left bg-transparent border-0 p-0"
        >
          <Icon className="w-3.5 h-3.5 text-primary/60 shrink-0" />
          <span className="text-[11px] font-mono uppercase tracking-[0.2em] text-on-surface-variant/55 flex-1">
            {title}
          </span>
          {summary && !open && (
            <span className="text-[11px] text-on-surface-variant/50 font-mono mr-1 max-w-[140px] truncate">
              {summary}
            </span>
          )}
          {open ? (
            <ChevronDown className="w-3.5 h-3.5 text-on-surface-variant/40 shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-on-surface-variant/40 shrink-0" />
          )}
        </button>
        {healthStatus && onHealthIconClick && (
          <span className="mr-1">
            <StatusDot status={healthStatus} onClick={onHealthIconClick} />
          </span>
        )}
      </div>
      {open && <div className="pb-1">{children}</div>}
    </div>
  );
}

// ─── Editable fields ──────────────────────────────────────────────────────────

function EditableField({
  label,
  description,
  value,
  isApiKey = false,
  onSave,
  disabled = false,
}: {
  label: string;
  description: string;
  value?: string;
  isApiKey?: boolean;
  onSave?: (v: string) => Promise<unknown>;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "ok" | "err">("idle");
  const [errMsg, setErrMsg] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function startEdit() {
    if (!onSave || disabled) return;
    setInput(isApiKey ? "" : (value ?? ""));
    setEditing(true);
    setSaveStatus("idle");
  }

  async function commit() {
    if (!onSave) {
      setEditing(false);
      return;
    }
    if (isApiKey && !input) {
      setEditing(false);
      return;
    }
    if (!isApiKey && input === value) {
      setEditing(false);
      return;
    }
    setSaveStatus("saving");
    setEditing(false);
    try {
      await onSave(input);
      setSaveStatus("ok");
      timerRef.current = setTimeout(() => setSaveStatus("idle"), 2000);
    } catch (e) {
      setSaveStatus("err");
      setErrMsg(e instanceof Error ? e.message : "保存失败");
      timerRef.current = setTimeout(() => setSaveStatus("idle"), 3000);
    }
  }

  function cancel() {
    setEditing(false);
    setSaveStatus("idle");
  }

  const maskedSuffix = isApiKey && value ? `…${value.slice(-4)}` : undefined;
  const displayValue = isApiKey ? (value ? `已配置（${maskedSuffix}）` : "—") : value || "—";
  const isEmpty = !value;
  const isEditable = !!onSave && !disabled;

  return (
    <div className="flex items-start justify-between px-4 py-2.5 gap-4 group">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-on-surface">{label}</p>
        <p className="text-[11px] text-on-surface-variant/55 mt-0.5">{description}</p>
      </div>
      <div className="shrink-0 flex items-center gap-2 mt-0.5 min-w-0">
        {saveStatus === "ok" && <CheckCircle2 className="w-3 h-3 text-primary shrink-0" />}
        {saveStatus === "err" && (
          <span title={errMsg}>
            <XCircle className="w-3 h-3 text-error shrink-0 cursor-help" />
          </span>
        )}
        {editing ? (
          <input
            ref={inputRef}
            type={isApiKey ? "password" : "text"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") cancel();
            }}
            placeholder={isApiKey && maskedSuffix ? `已配置（${maskedSuffix}）` : ""}
            className="text-[12px] font-mono bg-surface-container border border-outline-variant/20 rounded-lg px-2.5 py-1.5 w-52 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30 text-on-surface transition-shadow"
          />
        ) : (
          <button
            type="button"
            onClick={startEdit}
            disabled={!isEditable}
            className={`group/val flex items-center gap-1.5 rounded-lg px-2 py-1 -mr-2 transition-colors ${
              isEditable ? "hover:bg-surface-container cursor-text" : "cursor-default"
            }`}
          >
            <span
              className={`text-[11px] font-mono truncate max-w-[180px] text-right transition-colors ${
                isEmpty && !isApiKey
                  ? "text-on-surface-variant/30 italic"
                  : isEditable
                    ? "text-on-surface/70 group-hover/val:text-primary"
                    : "text-on-surface/70"
              }`}
            >
              {saveStatus === "saving" ? (
                <Loader2 className="w-3 h-3 animate-spin text-on-surface-variant/40 inline" />
              ) : (
                displayValue
              )}
            </span>
            {isEditable && (
              <ChevronRight className="w-3 h-3 text-primary/0 group-hover/val:text-primary/50 transition-colors shrink-0" />
            )}
          </button>
        )}
      </div>
    </div>
  );
}

function BooleanToggleField({
  label,
  description,
  value,
  onToggle,
}: {
  label: string;
  description: string;
  value: boolean;
  onToggle?: () => Promise<unknown>;
}) {
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "ok" | "err">("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  async function toggle() {
    if (!onToggle) return;
    setSaving(true);
    try {
      await onToggle();
      setSaveStatus("ok");
      timerRef.current = setTimeout(() => setSaveStatus("idle"), 2000);
    } catch {
      setSaveStatus("err");
      timerRef.current = setTimeout(() => setSaveStatus("idle"), 3000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-start justify-between px-4 py-2.5 gap-4 group hover:bg-surface-container/40 transition-colors">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-on-surface">{label}</p>
        <p className="text-[11px] text-on-surface-variant/55 mt-0.5">{description}</p>
      </div>
      <div className="flex items-center gap-2 mt-0.5 shrink-0">
        {saveStatus === "ok" && <CheckCircle2 className="w-3 h-3 text-primary" />}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={saving || !onToggle}
            onClick={toggle}
            className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${
              value ? "bg-primary" : "bg-on-surface-variant/25"
            } ${onToggle ? "cursor-pointer" : "cursor-default"}`}
          >
            <span
              className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${
                value ? "translate-x-3.5" : "translate-x-0.5"
              }`}
            />
          </button>
          <span className="text-[10px] font-mono text-on-surface-variant/50 w-4 select-none">
            {value ? "开" : "关"}
          </span>
        </div>
      </div>
    </div>
  );
}

function ProviderBadgeButton({
  provider,
  onToggle,
}: {
  provider: string;
  onToggle?: (next: string) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const isLocal = provider === "local";
  const nextProvider = isLocal ? "openai-compat" : "local";

  async function toggle() {
    if (!onToggle) return;
    setSaving(true);
    try {
      await onToggle(nextProvider);
    } finally {
      setSaving(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={saving || !onToggle}
      title={onToggle ? `切换到 ${nextProvider}` : undefined}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wide transition-opacity ${
        isLocal
          ? "bg-secondary-container/50 text-on-secondary-container"
          : "bg-primary/10 text-primary"
      } ${onToggle ? "hover:opacity-70 cursor-pointer" : "cursor-default"}`}
    >
      {saving ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : null}
      {provider}
    </button>
  );
}

function SubSectionLabel({ label }: { label: string }) {
  return (
    <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-on-surface-variant/55 px-4 pt-3 pb-1">
      {label}
    </p>
  );
}

function FieldGroup({
  label,
  statusDot,
  children,
}: {
  label: string;
  statusDot?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-4 mb-3 rounded-xl border border-outline-variant/10 bg-surface-container-lowest overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-outline-variant/10 bg-surface-container/30">
        <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-on-surface-variant/55">
          {label}
        </p>
        {statusDot}
      </div>
      <div className="divide-y divide-outline-variant/8">{children}</div>
    </div>
  );
}

// ─── File browser modal ───────────────────────────────────────────────────────

function FileBrowserModal({
  fieldLabel,
  initialPath,
  onSelect,
  onClose,
}: {
  fieldLabel: string;
  initialPath: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}) {
  const [currentPath, setCurrentPath] = useState(initialPath || "/");
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const navigate = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await browseFsDirectory(path);
      if (typeof res?.path !== "string" || !Array.isArray(res?.entries)) {
        throw new Error("服务器返回了无效响应，请检查 /hub 代理是否配置正确");
      }
      setCurrentPath(res.path);
      setEntries(res.entries);
    } catch (e) {
      setError(e instanceof Error ? e.message : "无法读取目录");
    } finally {
      setLoading(false);
    }
  }, []);

  // Load initial directory on mount.
  useEffect(() => {
    navigate(initialPath || "/");
  }, [initialPath, navigate]);

  // Global Escape key handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [onClose]);

  // Lock body scroll
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const crumbs = (currentPath || "/").split("/").filter(Boolean);

  const modal = (
    <dialog
      open
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      aria-label={`选择目录 — ${fieldLabel}`}
    >
      <div className="flex flex-col w-[480px] max-w-[90vw] max-h-[70vh] bg-surface-container-lowest rounded-2xl border border-outline-variant/20 shadow-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-outline-variant/10 shrink-0">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-on-surface">选择目录</p>
            <p className="text-[10px] font-mono text-on-surface-variant/50 mt-0.5 truncate">
              {fieldLabel}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded-lg text-on-surface-variant/50 hover:bg-surface-container hover:text-on-surface transition-colors shrink-0 ml-3"
          >
            <XCircle className="w-4 h-4" />
          </button>
        </div>

        {/* Breadcrumb */}
        <div className="flex items-center gap-0.5 px-3 py-2 border-b border-outline-variant/8 bg-surface-container-low overflow-x-auto shrink-0">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="text-[11px] font-mono text-primary/70 hover:text-primary shrink-0 transition-colors"
          >
            /
          </button>
          {crumbs.map((part, i) => {
            const path = `/${crumbs.slice(0, i + 1).join("/")}`;
            return (
              <span key={path} className="flex items-center gap-0.5 shrink-0">
                <ChevronRight className="w-2.5 h-2.5 text-on-surface-variant/25" />
                <button
                  type="button"
                  onClick={() => navigate(path)}
                  className="text-[11px] font-mono text-on-surface-variant/55 hover:text-primary transition-colors max-w-[120px] truncate"
                >
                  {part}
                </button>
              </span>
            );
          })}
        </div>

        {/* Directory list */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-5 h-5 animate-spin text-on-surface-variant/35" />
            </div>
          ) : error ? (
            <div className="flex items-start gap-2 px-4 py-4">
              <AlertCircle className="w-3.5 h-3.5 text-error shrink-0 mt-0.5" />
              <p className="text-[11px] text-error font-mono">{error}</p>
            </div>
          ) : entries.length === 0 ? (
            <div className="px-4 py-6 text-center text-[11px] text-on-surface-variant/35 font-mono">
              （空目录）
            </div>
          ) : (
            <div>
              {entries.map((entry) => (
                <button
                  key={entry.name}
                  type="button"
                  onClick={() => navigate(`${currentPath}/${entry.name}`)}
                  className="w-full flex items-center gap-2.5 px-4 py-2 text-left hover:bg-surface-container transition-colors border-b border-outline-variant/8 last:border-b-0"
                >
                  <HardDrive className="w-3.5 h-3.5 text-on-surface-variant/35 shrink-0" />
                  <span className="text-[12px] font-mono text-on-surface/80 truncate">
                    {entry.name}
                  </span>
                  <ChevronRight className="w-3 h-3 text-on-surface-variant/25 shrink-0 ml-auto" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-outline-variant/10 bg-surface-container-low shrink-0">
          <span className="text-[10px] font-mono text-on-surface-variant/40 truncate min-w-0">
            {currentPath}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="text-[12px] text-on-surface-variant/55 hover:text-on-surface px-3 py-1.5 rounded-lg hover:bg-surface-container transition-colors"
            >
              取消
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => {
                onSelect(currentPath);
                onClose();
              }}
              className="text-[12px] bg-primary text-white px-3 py-1.5 rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              选择此目录
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );

  return createPortal(modal, document.body);
}

function PathField({
  label,
  description,
  value,
  onSave,
}: {
  label: string;
  description: string;
  value?: string;
  onSave?: (path: string) => Promise<unknown>;
}) {
  const [browserOpen, setBrowserOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "ok" | "err">("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  async function handleSelect(path: string) {
    if (!onSave) return;
    try {
      await onSave(path);
      setSaveStatus("ok");
      timerRef.current = setTimeout(() => setSaveStatus("idle"), 2000);
    } catch {
      setSaveStatus("err");
      timerRef.current = setTimeout(() => setSaveStatus("idle"), 3000);
    }
  }

  return (
    <div className="flex items-start justify-between px-4 py-2.5 gap-4 group">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-on-surface">{label}</p>
        <p className="text-[11px] text-on-surface-variant/55 mt-0.5">{description}</p>
      </div>
      <div className="shrink-0 flex items-center gap-2 mt-0.5">
        {saveStatus === "ok" && <CheckCircle2 className="w-3 h-3 text-primary shrink-0" />}
        {saveStatus === "err" && <XCircle className="w-3 h-3 text-error shrink-0" />}
        <span className="text-[11px] font-mono text-on-surface/70 truncate max-w-[140px] text-right">
          {value || "—"}
        </span>
        {onSave && (
          <button
            type="button"
            onClick={() => setBrowserOpen(true)}
            className="flex items-center gap-1 text-[11px] font-mono text-on-surface-variant/55 hover:text-primary bg-surface-container hover:bg-surface-container-high border border-outline-variant/15 rounded-lg px-2 py-1 transition-colors shrink-0"
          >
            浏览
          </button>
        )}
      </div>
      {browserOpen && (
        <FileBrowserModal
          fieldLabel={label}
          initialPath={value || "/"}
          onSelect={handleSelect}
          onClose={() => setBrowserOpen(false)}
        />
      )}
    </div>
  );
}

// ─── Section components ───────────────────────────────────────────────────────

function LLMSection({
  cfg,
  patch,
}: {
  cfg: ScholarConfig;
  patch: (p: DeepPartial<ScholarConfig>) => Promise<ScholarConfig>;
}) {
  const hc = useHealthCheck("llm");
  return (
    <CollapsibleSection
      icon={Brain}
      title="LLM"
      summary={cfg.llm.model}
      healthStatus={hc.status}
      onHealthIconClick={hc.toggleDetail}
    >
      {hc.detailOpen && <HealthDetailPanel levels={hc.levels} onRecheck={hc.recheck} />}
      <EditableField
        label="Backend"
        description="推理后端协议类型"
        value={cfg.llm.backend}
        onSave={async (v) => {
          await patch({ llm: { backend: v } });
          hc.triggerDebounced();
        }}
      />
      <EditableField
        label="Model"
        description="使用的语言模型名称"
        value={cfg.llm.model}
        onSave={async (v) => {
          await patch({ llm: { model: v } });
          hc.triggerDebounced();
        }}
      />
      <EditableField
        label="Base URL"
        description="API 服务基础地址"
        value={cfg.llm.base_url}
        onSave={async (v) => {
          await patch({ llm: { base_url: v } });
          hc.triggerDebounced();
        }}
      />
      <EditableField
        label="API Key"
        description="访问凭证（提交空值不修改）"
        value={cfg.llm.api_key}
        isApiKey
        onSave={async (v) => {
          await patch({ llm: { api_key: v } });
          hc.triggerDebounced();
        }}
      />
    </CollapsibleSection>
  );
}

function EmbedSection({
  cfg,
  patch,
}: {
  cfg: ScholarConfig;
  patch: (p: DeepPartial<ScholarConfig>) => Promise<ScholarConfig>;
}) {
  const isLocal = cfg.embed.provider === "local";
  const scope = isLocal ? "embed.local" : "embed.api";
  const hc = useHealthCheck(scope);

  return (
    <CollapsibleSection
      icon={Layers}
      title="Embedding"
      summary={
        <span className="flex items-center gap-1.5">
          <span>{cfg.embed.model}</span>
          <span
            className={`text-[9px] font-mono uppercase px-1 py-0.5 rounded ${
              isLocal
                ? "bg-secondary-container/50 text-on-secondary-container"
                : "bg-primary/10 text-primary"
            }`}
          >
            {cfg.embed.provider}
          </span>
        </span>
      }
      healthStatus={hc.status}
      onHealthIconClick={hc.toggleDetail}
    >
      {hc.detailOpen && <HealthDetailPanel levels={hc.levels} onRecheck={hc.recheck} />}
      <div className="flex items-start justify-between px-4 py-2.5 gap-6">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-on-surface">Provider</p>
          <p className="text-[11px] text-on-surface-variant/55 mt-0.5">
            向量嵌入后端类型（点击切换）
          </p>
        </div>
        <div className="shrink-0 mt-0.5">
          <ProviderBadgeButton
            provider={cfg.embed.provider}
            onToggle={async (next) => {
              await patch({ embed: { provider: next } });
              hc.triggerDebounced();
            }}
          />
        </div>
      </div>
      <EditableField
        label="Model"
        description="使用的向量模型名称"
        value={cfg.embed.model}
        onSave={async (v) => {
          await patch({ embed: { model: v } });
          hc.triggerDebounced();
        }}
      />
      {isLocal ? (
        <>
          <EditableField
            label="Source"
            description="模型下载来源（modelscope / huggingface）"
            value={cfg.embed.source}
            onSave={(v) => patch({ embed: { source: v } })}
          />
          <EditableField
            label="Cache Dir"
            description="本地模型缓存目录"
            value={cfg.embed.cache_dir}
            onSave={async (v) => {
              await patch({ embed: { cache_dir: v } });
              hc.triggerDebounced();
            }}
          />
        </>
      ) : (
        <>
          <EditableField
            label="API Base"
            description="云端嵌入 API 地址"
            value={cfg.embed.api_base}
            onSave={async (v) => {
              await patch({ embed: { api_base: v } });
              hc.triggerDebounced();
            }}
          />
          <EditableField
            label="API Key"
            description="云端嵌入访问凭证（提交空值不修改）"
            value={cfg.embed.api_key}
            isApiKey
            onSave={async (v) => {
              await patch({ embed: { api_key: v } });
              hc.triggerDebounced();
            }}
          />
        </>
      )}
    </CollapsibleSection>
  );
}

function IngestSection({
  cfg,
  patch,
}: {
  cfg: ScholarConfig;
  patch: (p: DeepPartial<ScholarConfig>) => Promise<ScholarConfig>;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const hcLocal = useHealthCheck("ingest.mineru_local");
  const hcCloud = useHealthCheck("ingest.mineru_cloud");

  return (
    <CollapsibleSection
      icon={ArrowDownToLine}
      title="Ingest"
      summary={cfg.ingest.pdf_preferred_parser}
      defaultOpen
    >
      <div className="px-4 pt-1 pb-2">
        <EditableField
          label="PDF Parser"
          description="首选 PDF 解析器（mineru / docling / pymupdf）"
          value={cfg.ingest.pdf_preferred_parser}
          onSave={(v) => patch({ ingest: { pdf_preferred_parser: v } })}
        />
      </div>

      <FieldGroup
        label="MinerU Local（优先）"
        statusDot={<StatusDot status={hcLocal.status} onClick={hcLocal.toggleDetail} />}
      >
        {hcLocal.detailOpen && (
          <HealthDetailPanel levels={hcLocal.levels} onRecheck={hcLocal.recheck} />
        )}
        <EditableField
          label="Endpoint"
          description="本地 MinerU 服务地址"
          value={cfg.ingest.mineru_endpoint}
          onSave={async (v) => {
            await patch({ ingest: { mineru_endpoint: v } });
            hcLocal.triggerDebounced();
          }}
        />
      </FieldGroup>

      <FieldGroup
        label="MinerU Cloud（备用）"
        statusDot={<StatusDot status={hcCloud.status} onClick={hcCloud.toggleDetail} />}
      >
        {hcCloud.detailOpen && (
          <HealthDetailPanel levels={hcCloud.levels} onRecheck={hcCloud.recheck} />
        )}
        <EditableField
          label="Cloud URL"
          description="MinerU 云端 API 基础地址"
          value={cfg.ingest.mineru_cloud_url}
          onSave={async (v) => {
            await patch({ ingest: { mineru_cloud_url: v } });
            hcCloud.triggerDebounced();
          }}
        />
        <EditableField
          label="API Key"
          description="MinerU 云端访问凭证（提交空值不修改）"
          value={cfg.ingest.mineru_api_key}
          isApiKey
          onSave={async (v) => {
            await patch({ ingest: { mineru_api_key: v } });
            hcCloud.triggerDebounced();
          }}
        />
      </FieldGroup>

      <FieldGroup label="Semantic Scholar">
        <EditableField
          label="S2 API Key"
          description="有 key 可大幅提升限速（提交空值不修改）"
          value={cfg.ingest.s2_api_key}
          isApiKey
          onSave={(v) => patch({ ingest: { s2_api_key: v } })}
        />
      </FieldGroup>

      <div className="px-4 pb-2 mt-1">
        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-surface-container transition-colors text-left"
        >
          {advancedOpen ? (
            <ChevronDown className="w-3 h-3 text-on-surface-variant/50 shrink-0" />
          ) : (
            <ChevronRight className="w-3 h-3 text-on-surface-variant/50 shrink-0" />
          )}
          <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-on-surface-variant/55">
            高级选项
          </span>
        </button>
      </div>

      {advancedOpen && (
        <FieldGroup label="高级选项">
          <EditableField
            label="OCR Language"
            description="MinerU OCR 识别语言（ch / en / latin 等）"
            value={cfg.ingest.mineru_lang}
            onSave={(v) => patch({ ingest: { mineru_lang: v } })}
          />
          <EditableField
            label="Parse Method"
            description="解析方式（auto / txt / ocr）"
            value={cfg.ingest.mineru_parse_method}
            onSave={(v) => patch({ ingest: { mineru_parse_method: v } })}
          />
          <EditableField
            label="Abstract LLM Mode"
            description="摘要提取 LLM 介入模式（off / fallback / verify）"
            value={cfg.ingest.abstract_llm_mode}
            onSave={(v) => patch({ ingest: { abstract_llm_mode: v } })}
          />
          <BooleanToggleField
            label="Formula Parsing"
            description="是否启用公式解析（云端有效）"
            value={cfg.ingest.mineru_enable_formula}
            onToggle={() =>
              patch({ ingest: { mineru_enable_formula: !cfg.ingest.mineru_enable_formula } })
            }
          />
          <BooleanToggleField
            label="Table Parsing"
            description="是否启用表格解析（云端有效）"
            value={cfg.ingest.mineru_enable_table}
            onToggle={() =>
              patch({ ingest: { mineru_enable_table: !cfg.ingest.mineru_enable_table } })
            }
          />
        </FieldGroup>
      )}
    </CollapsibleSection>
  );
}

function PathsSection({
  cfg,
  patch,
}: {
  cfg: ScholarConfig;
  patch: (p: DeepPartial<ScholarConfig>) => Promise<ScholarConfig>;
}) {
  return (
    <CollapsibleSection icon={HardDrive} title="Paths">
      <PathField
        label="Papers Dir"
        description="论文文件存储目录"
        value={cfg.paths.papers_dir}
        onSave={(p) => patch({ paths: { papers_dir: p } })}
      />
      <PathField
        label="Workspace Dir"
        description="工作区根目录"
        value={cfg.paths.workspace_dir}
        onSave={(p) => patch({ paths: { workspace_dir: p } })}
      />
    </CollapsibleSection>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function SettingsPage() {
  const { setTitle } = usePageTitle();
  const { selectedProvider, setSelectedProvider, setSelectedProjectId } = useProjectScope();

  useEffect(() => {
    setTitle("Settings");
    return () => setTitle("");
  }, [setTitle]);

  const providersQuery = useQuery({
    queryKey: queryKeys.providers(),
    queryFn: ({ signal }) => api.getProviders({ signal }),
    select: (data) => data.providers,
  });
  const scholarConfigQuery = useQuery({
    queryKey: queryKeys.scholar.config(),
    queryFn: ({ signal }) => scholar.getConfig({ signal }),
    retry: false,
  });
  const usageLimitsQuery = useQuery({
    queryKey: queryKeys.providerUsageLimits(),
    queryFn: ({ signal }) => api.getProviderUsageLimits({ signal }),
    select: (data) => data.usageLimits,
    refetchInterval: 60_000,
  });

  const patchMutation = usePatchConfig();
  const patchConfig = useCallback(
    (p: DeepPartial<ScholarConfig>) => patchMutation.mutateAsync(p),
    [patchMutation],
  );

  const providers: ProviderInfo[] = providersQuery.data ?? [];
  const usageLimits: ProviderUsageLimits[] = usageLimitsQuery.data ?? [];
  const loadingProviders = providersQuery.isLoading;
  const scholarConfig: ScholarConfig | null = scholarConfigQuery.data ?? null;
  const scholarConfigError = !!scholarConfigQuery.error;

  const handleProviderSelect = (group: ProviderGroup) => {
    if (!isGroupEnabled(providers, group)) return;
    setSelectedProvider(group);
    setSelectedProjectId(null);
  };

  return (
    <div className="pt-3 pb-6 flex flex-col gap-6">
      {/* Agent selector cards */}
      <div>
        <div className="max-w-3xl mx-auto">
          <SectionLabel label="Agent" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {(["claude", "codex"] as ProviderGroup[]).map((group) => {
              const enabled = !loadingProviders && isGroupEnabled(providers, group);
              const isSelected = selectedProvider === group;
              const email = getGroupEmail(providers, group);
              const limits = getGroupUsageLimits(usageLimits, group);
              const cfg = AGENT_CONFIG[group];
              return (
                <button
                  key={group}
                  type="button"
                  disabled={!enabled}
                  onClick={() => handleProviderSelect(group)}
                  className={`relative block w-full rounded-2xl border overflow-hidden text-left transition-all duration-200 ${
                    isSelected
                      ? "border-primary/40 bg-primary/5 shadow-sm"
                      : enabled
                        ? "cursor-pointer border-outline-variant/20 bg-surface-container-low hover:border-outline-variant/40 hover:bg-surface-container"
                        : "cursor-not-allowed border-outline-variant/10 bg-surface-container-low/50"
                  }`}
                >
                  <span
                    className={`relative flex w-full items-center gap-3 px-4 py-3.5 ${
                      enabled ? "" : "opacity-40"
                    }`}
                  >
                    <img
                      src={cfg.icon}
                      alt={cfg.name}
                      className="w-9 h-9 shrink-0 rounded-lg object-contain"
                    />
                    <span className="block min-w-0 flex-1 pr-6">
                      <span className="block text-sm font-semibold text-on-surface">
                        {cfg.name}
                      </span>
                      <span className="block text-[10px] font-mono text-on-surface-variant/60 truncate mt-0.5">
                        {loadingProviders
                          ? "Detecting…"
                          : enabled
                            ? (email ?? "Active")
                            : "Not detected"}
                      </span>
                    </span>
                    {isSelected ? (
                      <CheckCircle2 className="w-4 h-4 text-primary fill-primary/10 shrink-0 absolute top-3 right-3" />
                    ) : null}
                  </span>
                  <UsageLimitBlock limits={limits} loading={usageLimitsQuery.isLoading} />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ScholarAIO config */}
      <div>
        <div className="max-w-3xl mx-auto">
          <SectionLabel label="ScholarAIO" />
          <div className="bg-surface-container-low rounded-xl border border-outline-variant/10">
            {scholarConfigError ? (
              <div className="flex items-center gap-2 px-4 py-3.5 text-[11px] text-on-surface-variant/60">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>
                  服务未运行。执行 <code className="font-mono">scholaraio serve</code> 后刷新。
                </span>
              </div>
            ) : scholarConfig === null ? (
              <div className="px-4 py-3.5 text-[11px] text-on-surface-variant/50 font-mono">
                Loading…
              </div>
            ) : (
              <>
                <LLMSection cfg={scholarConfig} patch={patchConfig} />
                <EmbedSection cfg={scholarConfig} patch={patchConfig} />
                <IngestSection cfg={scholarConfig} patch={patchConfig} />
                <PathsSection cfg={scholarConfig} patch={patchConfig} />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
