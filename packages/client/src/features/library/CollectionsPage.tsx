import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, AtSign, Library, Pencil, Plus, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { collectionUrl, libraryApi } from "../../core/library";
import { newSessionUrl } from "../../core/sessions";
import { errorMessage } from "../../shared/format";
import { CollectionCreateDialog } from "./components/CollectionCreateDialog";

/**
 * Every literature collection the library holds: named sets of papers a
 * session can refer to (`@` in the composer), as a list rather than a wall of cards.
 */
export function CollectionsPage() {
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  const collections = useQuery({
    queryKey: ["library", "collections"],
    queryFn: ({ signal }) => libraryApi.collections(signal),
    select: (data) => data.collections,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["library", "collections"] });
  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      libraryApi.renameCollection(id, name),
    onSuccess: () => {
      setError("");
      void refresh();
    },
    onError: (err) => setError(errorMessage(err, "重命名失败")),
  });
  const archive = useMutation({
    mutationFn: (id: string) => libraryApi.archiveCollection(id),
    onSuccess: () => {
      setError("");
      void refresh();
    },
    onError: (err) => setError(errorMessage(err, "归档失败")),
  });

  const list = collections.data ?? [];
  const loading = collections.isLoading || collections.isFetching;
  const displayError = error || collections.error?.message;

  return (
    <div className="w-full max-w-2xl mx-auto px-6 pt-4 pb-6">
      <div className="flex items-center justify-end gap-2 pb-2">
        <button
          type="button"
          onClick={() => void collections.refetch()}
          title="刷新"
          aria-label="刷新文献集合列表"
          className="flex items-center justify-center w-7 h-7 rounded-md text-on-surface-variant hover:bg-surface-container border-0 bg-transparent cursor-pointer"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-on-primary border-0 cursor-pointer hover:opacity-90"
        >
          <Plus className="w-4 h-4" />
          新建
        </button>
      </div>

      {displayError ? (
        <p role="alert" className="py-2 text-sm text-error">
          {displayError}
        </p>
      ) : null}
      {loading && list.length === 0 ? (
        <p className="py-8 text-center text-sm text-on-surface-variant/60">加载中…</p>
      ) : null}
      {!loading && list.length === 0 ? (
        <p className="py-12 text-center text-sm text-on-surface-variant/60">
          还没有文献集合，先新建一个。
        </p>
      ) : null}

      <ul className="divide-y divide-outline-variant/10">
        {list.map((collection) => (
          <li
            key={collection.id}
            className="group flex items-center gap-3 px-2 py-2.5 hover:bg-surface-container/60"
          >
            <Library className="w-4 h-4 shrink-0 text-on-surface-variant" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <Link
                to={collectionUrl(collection.id)}
                className="block truncate text-sm text-on-surface hover:text-primary"
              >
                {collection.name}
              </Link>
              <p className="truncate text-[11px] font-mono text-on-surface-variant/60">
                {collection.paperCount} 篇文献
              </p>
            </div>
            <Link
              to={newSessionUrl({ references: [{ kind: "collection", id: collection.id }] })}
              className="flex shrink-0 items-center gap-1 text-xs text-primary opacity-0 group-hover:opacity-100 focus:opacity-100"
            >
              <AtSign className="w-3.5 h-3.5" aria-hidden="true" />
              在会话中引用
            </Link>
            <button
              type="button"
              title="重命名"
              aria-label={`重命名 ${collection.name}`}
              disabled={rename.isPending}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border-0 bg-transparent text-on-surface-variant/60 hover:bg-surface-container hover:text-on-surface disabled:opacity-50 cursor-pointer"
              onClick={() => {
                const name = window.prompt("新的文献集合名称", collection.name)?.trim();
                if (name && name !== collection.name) rename.mutate({ id: collection.id, name });
              }}
            >
              <Pencil className="w-4 h-4" />
            </button>
            <button
              type="button"
              title="归档"
              aria-label={`归档 ${collection.name}`}
              disabled={archive.isPending}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border-0 bg-transparent text-on-surface-variant/60 hover:bg-surface-container hover:text-error disabled:opacity-50 cursor-pointer"
              onClick={() => {
                if (
                  window.confirm(
                    `归档「${collection.name}」？引用它的会话将不再从中检索；目录会移入回收区，可在数据目录中找回。`,
                  )
                )
                  archive.mutate(collection.id);
              }}
            >
              <Archive className="w-4 h-4" />
            </button>
          </li>
        ))}
      </ul>

      {creating ? <CollectionCreateDialog onClose={() => setCreating(false)} /> : null}
    </div>
  );
}
