import type { FileContentResponse, ProjectFsEntry } from "@scholaraio-hub/shared";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  File,
  Folder,
  FolderOpen,
  Maximize2,
  Minimize2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../core/api";

interface FsNode {
  id: string;
  name: string;
  isDir: boolean;
  isDotfile: boolean;
  children?: FsNode[] | null;
}

function buildRootNode(name: string): FsNode {
  return {
    id: "",
    name,
    isDir: true,
    isDotfile: false,
    children: null,
  };
}

function entriesToNodes(parentPath: string, entries: ProjectFsEntry[]): FsNode[] {
  return entries.map((e) => ({
    id: parentPath ? `${parentPath}/${e.name}` : e.name,
    name: e.name,
    isDir: e.isDir,
    isDotfile: e.isDotfile,
    children: e.isDir ? null : undefined,
  }));
}

function updateNodeChildren(nodes: FsNode[], targetId: string, children: FsNode[]): FsNode[] {
  return nodes.map((node) => {
    if (node.id === targetId) return { ...node, children };
    if (node.children && node.children.length > 0) {
      return { ...node, children: updateNodeChildren(node.children, targetId, children) };
    }
    return node;
  });
}

interface TreeNodeProps {
  node: FsNode;
  depth: number;
  expanded: Set<string>;
  loading: Set<string>;
  onToggle: (node: FsNode) => void;
  onFileClick: (node: FsNode) => void;
  selectedPath: string | null;
}

function TreeNode({
  node,
  depth,
  expanded,
  loading,
  onToggle,
  onFileClick,
  selectedPath,
}: TreeNodeProps) {
  const isExpanded = expanded.has(node.id);
  const isLoading = loading.has(node.id);
  const isSelected = selectedPath === node.id;

  const dimClass = node.isDotfile ? "opacity-50" : "";

  return (
    <div>
      <button
        type="button"
        className={`w-full flex items-center gap-1 px-2 py-0.5 text-left text-xs rounded hover:bg-surface-container cursor-pointer ${isSelected ? "bg-surface-container" : ""} ${dimClass}`}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        onClick={() => (node.isDir ? onToggle(node) : onFileClick(node))}
      >
        {node.isDir ? (
          <>
            <span className="text-on-surface-variant shrink-0">
              {isLoading ? (
                <span className="inline-block w-3 h-3 animate-spin border border-current border-t-transparent rounded-full" />
              ) : isExpanded ? (
                <ChevronDown size={12} />
              ) : (
                <ChevronRight size={12} />
              )}
            </span>
            <span className="text-on-surface-variant shrink-0">
              {isExpanded ? <FolderOpen size={13} /> : <Folder size={13} />}
            </span>
          </>
        ) : (
          <>
            <span className="w-3 shrink-0" />
            <span className="text-on-surface-variant shrink-0">
              <File size={13} />
            </span>
          </>
        )}
        <span className="truncate text-on-surface">{node.name}</span>
      </button>
      {node.isDir && isExpanded && node.children && node.children.length > 0 && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              loading={loading}
              onToggle={onToggle}
              onFileClick={onFileClick}
              selectedPath={selectedPath}
            />
          ))}
        </div>
      )}
      {node.isDir && isExpanded && node.children && node.children.length === 0 && (
        <div
          className="text-[10px] text-on-surface-variant opacity-50 italic"
          style={{ paddingLeft: `${8 + (depth + 1) * 14}px` }}
        >
          empty
        </div>
      )}
    </div>
  );
}

interface FileViewerProps {
  projectId: string;
  filePath: string;
  onBack: () => void;
  onFullscreen: () => void;
  isFullscreen: boolean;
}

function FileViewer({ projectId, filePath, onBack, onFullscreen, isFullscreen }: FileViewerProps) {
  const [file, setFile] = useState<FileContentResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setFile(null);
    setError("");
    setLoading(true);
    const controller = new AbortController();
    api
      .getFile(projectId, filePath, true, { signal: controller.signal })
      .then((data) => {
        setFile(data);
        setLoading(false);
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Failed to load file");
        setLoading(false);
      });
    return () => controller.abort();
  }, [projectId, filePath]);

  const fileName = filePath.split("/").pop() ?? filePath;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-outline-variant/10 shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="text-on-surface-variant hover:text-on-surface transition-colors"
          title="Back to file tree"
        >
          <ArrowLeft size={14} />
        </button>
        <span className="text-xs text-on-surface truncate flex-1 font-mono" title={filePath}>
          {fileName}
        </span>
        <button
          type="button"
          onClick={onFullscreen}
          className="text-on-surface-variant hover:text-on-surface transition-colors"
          title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
        >
          {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </button>
      </div>
      <div className="flex-1 overflow-auto min-h-0 p-3">
        {loading && <div className="text-xs text-on-surface-variant">Loading…</div>}
        {error && <div className="text-xs text-red-500">{error}</div>}
        {file &&
          (file.renderedMarkdownHtml ? (
            <div
              className="prose prose-sm max-w-none text-on-surface"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: server-rendered HTML
              dangerouslySetInnerHTML={{ __html: file.renderedMarkdownHtml }}
            />
          ) : file.highlightedHtml ? (
            <div
              className="text-xs font-mono"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: server-rendered HTML
              dangerouslySetInnerHTML={{ __html: file.highlightedHtml }}
            />
          ) : file.content ? (
            <pre className="text-xs font-mono whitespace-pre-wrap text-on-surface">
              {file.content}
            </pre>
          ) : (
            <div className="text-xs text-on-surface-variant italic">
              Binary file — not previewable
            </div>
          ))}
      </div>
    </div>
  );
}

interface ProjectFilesPanelProps {
  projectId: string;
  rootName?: string | null;
  onClose: () => void;
}

export function ProjectFilesPanel({ projectId, rootName, onClose }: ProjectFilesPanelProps) {
  const displayRootName = rootName ?? "/";
  const [nodes, setNodes] = useState<FsNode[]>(() => [buildRootNode(displayRootName)]);
  useEffect(() => {
    setNodes((prev) => prev.map((n) => (n.id === "" ? { ...n, name: displayRootName } : n)));
  }, [displayRootName]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([""]));
  const [loadingSet, setLoadingSet] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const loadChildren = useCallback(
    async (node: FsNode) => {
      if (loadingSet.has(node.id)) return;
      setLoadingSet((prev) => new Set(prev).add(node.id));
      try {
        const result = await api.browseProjectFs(projectId, node.id);
        const children = entriesToNodes(node.id, result.entries);
        setNodes((prev) => updateNodeChildren(prev, node.id, children));
      } catch {
        // leave children as null so user can retry
      } finally {
        setLoadingSet((prev) => {
          const next = new Set(prev);
          next.delete(node.id);
          return next;
        });
      }
    },
    [projectId, loadingSet],
  );

  const handleToggle = useCallback(
    (node: FsNode) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(node.id)) {
          next.delete(node.id);
        } else {
          next.add(node.id);
          if (node.children === null) {
            void loadChildren(node);
          }
        }
        return next;
      });
    },
    [loadChildren],
  );

  // Load root on mount — root id is always "" (project root)
  useEffect(() => {
    void api.browseProjectFs(projectId).then((result) => {
      const children = entriesToNodes("", result.entries);
      setNodes((prev) => updateNodeChildren(prev, "", children));
    });
  }, [projectId]);

  const treeContent = (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between px-3 py-2 border-b border-outline-variant/10 shrink-0">
        <span className="text-xs font-medium text-on-surface-variant uppercase tracking-wide">
          Files
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-on-surface-variant hover:text-on-surface transition-colors"
          title="Close"
        >
          <X size={13} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0 py-1">
        {nodes.map((node) => (
          <TreeNode
            key={node.id}
            node={node}
            depth={0}
            expanded={expanded}
            loading={loadingSet}
            onToggle={handleToggle}
            onFileClick={(n) => setSelectedFile(n.id)}
            selectedPath={selectedFile}
          />
        ))}
      </div>
    </div>
  );

  if (selectedFile) {
    return (
      <>
        {isFullscreen && (
          <div className="fixed inset-0 z-50 bg-surface flex flex-col">
            <FileViewer
              projectId={projectId}
              filePath={selectedFile}
              onBack={() => setIsFullscreen(false)}
              onFullscreen={() => setIsFullscreen(false)}
              isFullscreen={true}
            />
          </div>
        )}
        <FileViewer
          projectId={projectId}
          filePath={selectedFile}
          onBack={() => setSelectedFile(null)}
          onFullscreen={() => setIsFullscreen(true)}
          isFullscreen={false}
        />
      </>
    );
  }

  return treeContent;
}

const SIDEBAR_WIDTH_KEY = "project-files-panel-width";
const DEFAULT_WIDTH = 320;
const MIN_WIDTH = 200;
const MAX_WIDTH_VW = 0.5;

interface ResizablePanelProps {
  open: boolean;
  projectId: string;
  rootName?: string | null;
  onClose: () => void;
}

export function ResizableProjectFilesPanel({
  open,
  projectId,
  rootName,
  onClose,
}: ResizablePanelProps) {
  const [width, setWidth] = useState(() => {
    const stored = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return stored ? Math.max(MIN_WIDTH, Number(stored)) : DEFAULT_WIDTH;
  });
  const dragging = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  const startX = useRef(0);
  const startWidth = useRef(0);
  // Lazy mount: avoid the initial fs browse request until the user first opens
  // the panel; keep it mounted afterwards so reopens are instant.
  const [hasOpened, setHasOpened] = useState(open);
  useEffect(() => {
    if (open) setHasOpened(true);
  }, [open]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const delta = startX.current - e.clientX;
      const maxWidth = window.innerWidth * MAX_WIDTH_VW;
      const next = Math.min(maxWidth, Math.max(MIN_WIDTH, startWidth.current + delta));
      setWidth(next);
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      setIsDragging(false);
      setWidth((w) => {
        localStorage.setItem(SIDEBAR_WIDTH_KEY, String(w));
        return w;
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const onDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    setIsDragging(true);
    startX.current = e.clientX;
    startWidth.current = width;
  };

  return (
    <div
      className={`flex h-full shrink-0 justify-end overflow-hidden ${isDragging ? "" : "transition-[width] duration-200 ease-out"}`}
      style={{ width: open ? width : 0 }}
      aria-hidden={!open}
    >
      <div className="flex h-full shrink-0" style={{ width }}>
        {/* drag handle */}
        <div
          className="w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 shrink-0 transition-colors"
          onMouseDown={onDragStart}
        />
        <div className="flex-1 border-l border-outline-variant/10 bg-surface flex flex-col min-h-0 overflow-hidden">
          {hasOpened ? (
            <ProjectFilesPanel projectId={projectId} rootName={rootName} onClose={onClose} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
