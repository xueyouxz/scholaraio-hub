import { FolderPlus, Loader2, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface WorkspaceOption {
  id: string;
  name: string;
}

interface Props {
  workspaces: WorkspaceOption[];
  disabled?: boolean;
  pending?: boolean;
  selectedCount: number;
  onAdd: (workspaceName: string) => void;
  onCreateAndAdd: (newName: string) => void;
}

// Workspace names: same rules as scholar's validate_workspace_name (letters,
// digits, dash, underscore; no leading dot, length 1-64). Enforce client-side
// for instant feedback; server still has final say.
const NAME_RE = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,63}$/;

export function BatchAddDropdown({
  workspaces,
  disabled,
  pending,
  selectedCount,
  onAdd,
  onCreateAndAdd,
}: Props) {
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const trimmed = newName.trim();
  const nameValid = NAME_RE.test(trimmed);
  const nameDuplicate = workspaces.some((w) => w.name === trimmed);

  const handleCreate = () => {
    if (!nameValid || nameDuplicate) return;
    setNewName("");
    setOpen(false);
    onCreateAndAdd(trimmed);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled || selectedCount === 0}
        className="flex items-center gap-1.5 px-3 py-1.5 signature-gradient text-on-primary rounded-full text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed border-0 cursor-pointer"
      >
        {pending ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <FolderPlus className="w-3.5 h-3.5" />
        )}
        加入 Workspace
      </button>

      {open ? (
        <div className="absolute right-0 top-[calc(100%+6px)] z-30 w-64 bg-surface-container-highest border border-outline-variant/20 rounded-xl p-1.5 shadow-xl max-h-72 overflow-y-auto no-scrollbar">
          {/* Inline create */}
          <div className="p-1.5 border-b border-outline-variant/10 mb-1">
            <div className="flex items-center gap-1.5">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                placeholder="新建 workspace…"
                className="flex-1 bg-surface-container text-on-surface px-2.5 py-1.5 text-xs rounded-lg outline-none placeholder:text-on-surface-variant/50 focus:ring-1 focus:ring-primary/30"
              />
              <button
                type="button"
                onClick={handleCreate}
                disabled={!nameValid || nameDuplicate}
                title={
                  trimmed === ""
                    ? "请输入名称"
                    : !nameValid
                      ? "名称只允许字母/数字/-/_/."
                      : nameDuplicate
                        ? "名称已存在"
                        : "新建并加入"
                }
                className="p-1.5 rounded-lg text-primary hover:bg-primary/10 disabled:opacity-30 disabled:cursor-not-allowed border-0 bg-transparent cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {workspaces.length === 0 ? (
            <p className="text-xs text-on-surface-variant px-3 py-2">暂无已有 workspace</p>
          ) : (
            workspaces.map((ws) => (
              <button
                key={ws.id}
                type="button"
                onClick={() => {
                  setOpen(false);
                  onAdd(ws.name);
                }}
                className="w-full text-left px-3 py-2 text-xs rounded-lg text-on-surface hover:bg-surface-container transition-colors border-0 bg-transparent cursor-pointer"
              >
                {ws.name}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
