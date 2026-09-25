import { FolderPlus, Loader2, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { workspaceNameProblem } from "../workspaceName";

interface WorkspaceOption {
  id: string;
  name: string;
}

interface Props {
  workspaces: WorkspaceOption[];
  pending?: boolean;
  selectedCount: number;
  onAdd: (projectId: string) => void;
  onCreateAndAdd: (newName: string) => void;
}

export function AddToWorkspaceMenu({
  workspaces,
  pending,
  selectedCount,
  onAdd,
  onCreateAndAdd,
}: Props) {
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    // Focus the create input so Enter actually targets it.
    inputRef.current?.focus();
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const trimmed = newName.trim();
  const nameDuplicate = workspaces.some((w) => w.name === trimmed);
  const errorMessage =
    trimmed === ""
      ? null
      : (workspaceNameProblem(trimmed) ?? (nameDuplicate ? "名称已存在" : null));
  const canCreate = trimmed !== "" && !errorMessage && !pending;

  const handleCreate = () => {
    if (!canCreate) return;
    setNewName("");
    setOpen(false);
    onCreateAndAdd(trimmed);
  };

  const handleInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    // Ignore Enter that confirms IME composition.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    handleCreate();
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={selectedCount === 0}
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
        <div className="absolute right-0 bottom-[calc(100%+6px)] z-30 w-64 bg-surface-container-highest border border-outline-variant/20 rounded-xl p-1.5 shadow-xl max-h-72 overflow-y-auto">
          {/* Inline create */}
          <div className="p-1.5 border-b border-outline-variant/10 mb-1">
            <div className="flex items-center gap-1.5">
              <input
                ref={inputRef}
                aria-label="新建 workspace 名称"
                name="workspace"
                autoComplete="off"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder="新建 workspace…"
                className={`min-w-0 flex-1 bg-surface-container text-on-surface px-2.5 py-1.5 text-xs rounded-lg outline-none placeholder:text-on-surface-variant/50 focus:ring-1 ${
                  errorMessage
                    ? "focus:ring-error/50 ring-1 ring-error/40"
                    : "focus:ring-primary/30"
                }`}
              />
              <button
                type="button"
                onClick={handleCreate}
                disabled={!canCreate}
                title={
                  trimmed === ""
                    ? "请输入名称"
                    : (errorMessage ?? (pending ? "处理中…" : "新建并加入"))
                }
                className="p-1.5 rounded-lg text-primary hover:bg-primary/10 disabled:opacity-30 disabled:cursor-not-allowed border-0 bg-transparent cursor-pointer"
              >
                {pending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Plus className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
            {errorMessage ? (
              <p className="mt-1 px-1 text-[10px] text-error">{errorMessage}</p>
            ) : null}
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
