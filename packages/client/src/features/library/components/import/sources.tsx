import { ArrowRight, FileText, FolderOpen, Hash, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ChipGroup } from "../../../../shared/ui/ChipGroup";

/** Something chosen for import, not yet handed to the queue. */
export type Staged =
  | { kind: "file"; id: string; name: string; file: File }
  | { kind: "locator"; id: string; name: string }
  | { kind: "references"; id: string; name: string; file: File };

const SOURCES = [
  { value: "files", label: "本地文件" },
  { value: "locator", label: "按标识获取" },
  { value: "references", label: "书目文件" },
];

/**
 * Choosing papers to import, wherever that choice is made.
 *
 * Choosing is not importing: what the user picks is listed here and stays
 * removable until whoever owns this list hands it to the queue.
 */
export function ImportStaging({
  staged,
  onAdd,
  onDrop,
}: {
  staged: Staged[];
  onAdd: (entry: Staged) => void;
  onDrop: (id: string) => void;
}) {
  const [source, setSource] = useState("files");
  return (
    <>
      <ChipGroup label="来源" value={source} options={SOURCES} onChange={setSource} />

      {source === "files" ? <FileSource onAdd={onAdd} /> : null}
      {source === "locator" ? <LocatorSource onAdd={onAdd} /> : null}
      {source === "references" ? <ReferenceSource onAdd={onAdd} /> : null}

      {staged.length ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest text-on-surface-variant">
            待导入 {staged.length}
          </h3>
          <ul className="flex max-h-40 flex-col gap-1 overflow-auto">
            {staged.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center gap-2 rounded-lg bg-surface-container-low px-3 py-1.5"
              >
                {entry.kind === "locator" ? (
                  <Hash className="w-3.5 h-3.5 shrink-0 text-on-surface-variant" />
                ) : (
                  <FileText className="w-3.5 h-3.5 shrink-0 text-on-surface-variant" />
                )}
                <span className="min-w-0 flex-1 truncate text-xs text-on-surface">
                  {entry.name}
                </span>
                <button
                  type="button"
                  aria-label={`移除 ${entry.name}`}
                  onClick={() => onDrop(entry.id)}
                  className="rounded-full p-1 text-on-surface-variant hover:bg-surface-container-high border-0 bg-transparent cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function FileSource({ onAdd }: { onAdd: (entry: Staged) => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  useEffect(() => {
    folderInput.current?.setAttribute("webkitdirectory", "");
  }, []);
  const accept = (list: FileList | null) => {
    for (const file of Array.from(list ?? [])) {
      if (!file.name.toLowerCase().endsWith(".pdf")) continue;
      onAdd({
        kind: "file",
        id: `${file.name}:${file.size}:${file.lastModified}`,
        name: file.name,
        file,
      });
    }
  };
  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        accept(event.dataTransfer.files);
      }}
      className={`flex items-center justify-center gap-2 rounded-xl border border-dashed p-5 transition-colors ${
        over ? "border-primary bg-primary/5" : "border-outline-variant/30 bg-surface-container-low"
      }`}
    >
      <input
        ref={fileInput}
        type="file"
        multiple
        accept="application/pdf"
        className="sr-only"
        aria-label="选择 PDF 文件"
        onChange={(event) => {
          accept(event.target.files);
          event.target.value = "";
        }}
      />
      <input
        ref={folderInput}
        type="file"
        multiple
        className="sr-only"
        aria-label="选择文献目录"
        onChange={(event) => {
          accept(event.target.files);
          event.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => fileInput.current?.click()}
        className="inline-flex items-center gap-2 rounded-full bg-surface-container-high px-4 py-2 text-sm font-medium text-on-surface active:scale-95 border-0 cursor-pointer"
      >
        <Upload className="w-3.5 h-3.5" aria-hidden="true" />
        选择 PDF
      </button>
      <button
        type="button"
        onClick={() => folderInput.current?.click()}
        className="inline-flex items-center gap-2 rounded-full bg-surface-container-high px-4 py-2 text-sm font-medium text-on-surface active:scale-95 border-0 cursor-pointer"
      >
        <FolderOpen className="w-3.5 h-3.5" aria-hidden="true" />
        选择目录
      </button>
    </div>
  );
}

function LocatorSource({ onAdd }: { onAdd: (entry: Staged) => void }) {
  const [locator, setLocator] = useState("");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const value = locator.trim();
        if (!value) return;
        onAdd({ kind: "locator", id: value, name: value });
        setLocator("");
      }}
      className="flex items-center gap-2 rounded-full border border-outline-variant/20 bg-surface-container px-4 py-1.5 focus-within:ring-2 focus-within:ring-primary/20"
    >
      <label className="sr-only" htmlFor="import-locator">
        按标识获取文献
      </label>
      <input
        id="import-locator"
        name="locator"
        value={locator}
        onChange={(event) => setLocator(event.target.value)}
        placeholder="DOI、arXiv 编号、专利号或论文链接…"
        className="min-w-0 flex-1 bg-transparent text-sm text-on-surface outline-none placeholder:text-on-surface-variant/50"
      />
      <button
        type="submit"
        disabled={!locator.trim()}
        aria-label="加入待导入"
        className="rounded-full p-1.5 text-primary hover:bg-primary/10 disabled:text-on-surface-variant/40 border-0 bg-transparent cursor-pointer"
      >
        <ArrowRight className="w-4 h-4" />
      </button>
    </form>
  );
}

function ReferenceSource({ onAdd }: { onAdd: (entry: Staged) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".bib,.ris,.enw,.txt"
        className="sr-only"
        aria-label="选择 BibTeX 或 RIS 文件"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file)
            onAdd({
              kind: "references",
              id: `${file.name}:${file.lastModified}`,
              name: file.name,
              file,
            });
          event.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="self-start inline-flex items-center gap-2 rounded-full bg-surface-container-high px-4 py-2 text-sm font-medium text-on-surface active:scale-95 border-0 cursor-pointer"
      >
        <FileText className="w-3.5 h-3.5" aria-hidden="true" />
        选择 BibTeX / RIS 文件
      </button>
    </>
  );
}
