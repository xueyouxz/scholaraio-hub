import type { SessionFileContent, SessionFsEntry } from "@scholaraio-hub/shared";
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
import { sessionApi } from "../../../core/sessions";
import { Markdown } from "../../../shared/components/Markdown";
import { errorMessage } from "../../../shared/format";
import { ResizableSessionPanel } from "./ResizableSessionPanel";

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

function entriesToNodes(parentPath: string, entries: SessionFsEntry[]): FsNode[] {
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
        aria-expanded={node.isDir ? isExpanded : undefined}
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
  sessionId: string;
  filePath: string;
  onBack: () => void;
  onFullscreen: () => void;
  isFullscreen: boolean;
}

function FileViewer({ sessionId, filePath, onBack, onFullscreen, isFullscreen }: FileViewerProps) {
  const [file, setFile] = useState<SessionFileContent | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setFile(null);
    setError("");
    setLoading(true);
    const controller = new AbortController();
    sessionApi
      .file(sessionId, filePath, controller.signal)
      .then((data) => {
        setFile(data);
        setLoading(false);
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        setError(errorMessage(err, "Failed to load file"));
        setLoading(false);
      });
    return () => controller.abort();
  }, [sessionId, filePath]);

  const fileName = filePath.split("/").pop() ?? filePath;

  return (
    <div
      className="flex flex-col h-full min-h-0"
      onKeyDown={(event) => {
        if (event.key === "Escape") onBack();
      }}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-outline-variant/10 shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="text-on-surface-variant hover:text-on-surface transition-colors"
          title="返回文件树"
          aria-label="返回文件树"
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
        {file ? (
          <>
            {file.content !== undefined ? (
              filePath.endsWith(".md") ? (
                <Markdown text={file.content} />
              ) : (
                <pre className="text-xs font-mono whitespace-pre-wrap text-on-surface">
                  {file.content}
                </pre>
              )
            ) : (
              <div className="text-xs text-on-surface-variant italic">二进制文件暂不支持预览</div>
            )}
            {file.truncated ? (
              <p className="text-xs text-on-surface-variant">仅预览前 1 MB 内容。</p>
            ) : null}
            <a href={file.rawUrl} className="text-xs text-primary" download>
              下载文件
            </a>
          </>
        ) : null}
      </div>
    </div>
  );
}

interface SessionFilesPanelProps {
  sessionId: string;
  rootName: string;
  onClose: () => void;
}

export function SessionFilesPanel({ sessionId, rootName, onClose }: SessionFilesPanelProps) {
  const [nodes, setNodes] = useState<FsNode[]>(() => [buildRootNode(rootName)]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([""]));
  const [loadingSet, setLoadingSet] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [error, setError] = useState("");
  const requests = useRef(new Map<string, AbortController>());
  useEffect(
    () => () => {
      for (const controller of requests.current.values()) controller.abort();
    },
    [],
  );

  const loadChildren = useCallback(
    async (node: FsNode) => {
      if (requests.current.has(node.id)) return;
      const controller = new AbortController();
      requests.current.set(node.id, controller);
      setError("");
      setLoadingSet((prev) => new Set(prev).add(node.id));
      try {
        const result = await sessionApi.browseFiles(sessionId, node.id, controller.signal);
        const children = entriesToNodes(node.id, result.entries);
        setNodes((prev) => updateNodeChildren(prev, node.id, children));
      } catch (error) {
        if (!controller.signal.aborted) setError(errorMessage(error, "无法读取目录"));
      } finally {
        requests.current.delete(node.id);
        setLoadingSet((prev) => {
          const next = new Set(prev);
          next.delete(node.id);
          return next;
        });
      }
    },
    [sessionId],
  );

  const handleToggle = useCallback(
    (node: FsNode) => {
      const next = new Set(expanded);
      if (next.has(node.id)) next.delete(node.id);
      else {
        next.add(node.id);
        if (node.children === null) void loadChildren(node);
      }
      setExpanded(next);
    },
    [loadChildren, expanded],
  );

  // Load root on mount — root id is always "" (project root)
  useEffect(() => {
    void loadChildren(buildRootNode(rootName));
  }, [loadChildren, rootName]);

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
          title="关闭文件区"
          aria-label="关闭文件区"
        >
          <X size={13} />
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-error px-3">
          {error}
          <button
            type="button"
            className="ml-2 underline"
            onClick={() => void loadChildren(buildRootNode(rootName))}
          >
            重试
          </button>
        </p>
      ) : null}
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
              sessionId={sessionId}
              filePath={selectedFile}
              onBack={() => setIsFullscreen(false)}
              onFullscreen={() => setIsFullscreen(false)}
              isFullscreen={true}
            />
          </div>
        )}
        <FileViewer
          sessionId={sessionId}
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

export function ResizableSessionFilesPanel({
  open,
  sessionId,
  rootName,
  onClose,
}: { open: boolean; sessionId: string; rootName: string; onClose: () => void }) {
  return (
    <ResizableSessionPanel
      open={open}
      title="会话文件"
      storageKey="project-files-panel-width"
      onClose={onClose}
    >
      <SessionFilesPanel sessionId={sessionId} rootName={rootName} onClose={onClose} />
    </ResizableSessionPanel>
  );
}
