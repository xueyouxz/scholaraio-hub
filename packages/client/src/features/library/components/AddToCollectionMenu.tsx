import { FolderPlus, Loader2, Plus } from "lucide-react";
import { useCallback, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { MenuOption, Popover } from "../../../shared/ui/Menu";
import { collectionNameProblem } from "../collectionName";

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

export function AddToCollectionMenu({
  workspaces,
  pending,
  selectedCount,
  onAdd,
  onCreateAndAdd,
}: Props) {
  const [newName, setNewName] = useState("");
  // Focus the create input as the menu opens, so Enter actually targets it.
  const focusOnOpen = useCallback((input: HTMLInputElement | null) => input?.focus(), []);

  const trimmed = newName.trim();
  const nameDuplicate = workspaces.some((w) => w.name === trimmed);
  const errorMessage =
    trimmed === ""
      ? null
      : (collectionNameProblem(trimmed) ?? (nameDuplicate ? "名称已存在" : null));
  const canCreate = trimmed !== "" && !errorMessage && !pending;

  const handleCreate = (close: () => void) => {
    if (!canCreate) return;
    setNewName("");
    close();
    onCreateAndAdd(trimmed);
  };

  const handleInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>, close: () => void) => {
    if (e.key !== "Enter") return;
    // Ignore Enter that confirms IME composition.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    handleCreate(close);
  };

  return (
    <Popover
      disabled={selectedCount === 0}
      placement="above"
      align="end"
      panelClassName="w-64 max-h-72 overflow-y-auto"
      triggerClassName="flex items-center gap-1.5 px-3 py-1.5 signature-gradient text-on-primary rounded-full text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed border-0 cursor-pointer"
      trigger={() => (
        <>
          {pending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <FolderPlus className="w-3.5 h-3.5" />
          )}
          加入文献集合
        </>
      )}
    >
      {(close) => (
        <>
          {/* Inline create */}
          <div className="p-1.5 border-b border-outline-variant/10 mb-1">
            <div className="flex items-center gap-1.5">
              <input
                ref={focusOnOpen}
                aria-label="新建 workspace 名称"
                name="workspace"
                autoComplete="off"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(event) => handleInputKeyDown(event, close)}
                placeholder="新建 workspace…"
                className={`min-w-0 flex-1 bg-surface-container text-on-surface px-2.5 py-1.5 text-xs rounded-lg outline-none placeholder:text-on-surface-variant/50 focus:ring-1 ${
                  errorMessage
                    ? "focus:ring-error/50 ring-1 ring-error/40"
                    : "focus:ring-primary/30"
                }`}
              />
              <button
                type="button"
                onClick={() => handleCreate(close)}
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
            <p className="text-xs text-on-surface-variant px-3 py-2">暂无已有文献集合</p>
          ) : (
            workspaces.map((ws) => (
              <MenuOption
                key={ws.id}
                label={ws.name}
                dense
                onSelect={() => {
                  close();
                  onAdd(ws.name);
                }}
              />
            ))
          )}
        </>
      )}
    </Popover>
  );
}
