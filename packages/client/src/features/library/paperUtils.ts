import type { LibraryPaper } from "@scholaraio-hub/shared";
import type { ScholarPaper } from "../../core/scholarTypes";
import type { MiniChartBar, PaperReference, YearGroup } from "./types";

export function toLibraryPaperRef(p: LibraryPaper): PaperReference {
  return {
    id: p.id,
    title: p.title,
    authors: p.authors,
    source: p.journal,
    year: Number(p.year) || 0,
    citations: p.citationCounts
      ? Object.entries(p.citationCounts)
          .map(([source, count]) => `${source}: ${count}`)
          .join(" · ")
      : p.citationCount == null
        ? ""
        : String(p.citationCount),
    status: p.hasMarkdown ? "ingested" : p.hasPdf ? "pending" : "no-pdf",
    hasPdf: p.hasMarkdown,
    hasPdfFile: p.hasPdf,
    isIndexed: p.hasMarkdown,
    abstract: p.abstract,
    coverImage: p.coverImage,
    paperType: p.paperType,
    doi: p.doi,
    metadataStatus: p.metadataStatus,
    missingMetadata: p.missingMetadata,
  };
}

/** 将 API 返回的 ScholarPaper 映射为前端 PaperReference。 */
export function toPaperRef(p: ScholarPaper): PaperReference {
  return {
    id: p.id,
    title: p.title,
    authors: p.authors,
    source: p.source,
    year: p.year,
    date: p.date,
    citations: p.citations,
    status: p.status,
    hasPdf: p.hasPdf,
    hasPdfFile: p.hasPdfFile,
    isIndexed: p.isIndexed,
    abstract: p.abstract,
    coverImage: p.coverImage,
    paperType: p.paperType,
  };
}

/** 按年份降序分组文献。 */
export function groupByYear(papers: PaperReference[]): YearGroup[] {
  const map = new Map<number, PaperReference[]>();
  for (const p of papers) {
    const y = p.year || 0;
    if (!map.has(y)) map.set(y, []);
    (map.get(y) as PaperReference[]).push(p);
  }
  return [...map.entries()].sort((a, b) => b[0] - a[0]).map(([year, papers]) => ({ year, papers }));
}

/** 构建文献 PDF 的 API 访问 URL。 */
export function buildPdfUrl(paperId: string): string {
  return `/api/library/papers/${encodeURIComponent(paperId)}/pdf`;
}

/** 构建文献图片的 API 访问 URL（对应 paper.md 中的 images/ 相对路径）。 */
export function buildPaperImageUrl(paperId: string, filename: string): string {
  const relative = filename.startsWith("images/") ? filename : `images/${filename}`;
  return `/api/library/papers/${encodeURIComponent(paperId)}/attachments/${relative.split("/").map(encodeURIComponent).join("/")}`;
}

/** 判断文献是否有可读的 PDF 原文（paper.pdf 存在）。 */
export function canReadPdf(paper: PaperReference): boolean {
  return paper.hasPdfFile === true;
}

/** 判断文献是否有可读的层级内容（paper.md 存在，即 L4/L3 可用）。 */
export function canReadLayers(paper: PaperReference): boolean {
  return paper.hasPdf === true;
}

/** 判断文献是否可以在阅读器中打开（至少有 L4 内容或 PDF）。 */
export function canNavigateToReader(paper: PaperReference): boolean {
  return canReadLayers(paper) || canReadPdf(paper);
}

/** 在列表中按 ID 查找文献。 */
export function findPaperById(papers: PaperReference[], id: string): PaperReference | undefined {
  return papers.find((p) => p.id === id);
}

const SOURCE_ABBREV: Record<string, string> = {
  "IEEE Transactions on Visualization and Computer Graphics": "IEEE TVCG",
  "IEEE Transactions on Pattern Analysis and Machine Intelligence": "IEEE TPAMI",
  "International Journal of Computer Vision": "IJCV",
  "Neural Information Processing Systems": "NeurIPS",
  "International Conference on Machine Learning": "ICML",
  "International Conference on Learning Representations": "ICLR",
  "IEEE Conference on Computer Vision and Pattern Recognition": "CVPR",
  "European Conference on Computer Vision": "ECCV",
  "IEEE International Conference on Computer Vision": "ICCV",
  "ACM SIGGRAPH": "SIGGRAPH",
  "ACM Transactions on Graphics": "ACM TOG",
  Nature: "Nature",
  Science: "Science",
};

/** 将来源名称缩写为已知期刊/会议简称。 */
export function abbreviateSource(source: string): string {
  return SOURCE_ABBREV[source] ?? source;
}

/** 聚合文献类型分布，未知类型归入 "other"。 */
export function buildTypeDist(papers: PaperReference[]): MiniChartBar[] {
  const counts: Record<string, number> = {};
  for (const p of papers) {
    const raw = (p as PaperReference & { paperType?: string }).paperType;
    const key = normalizeType(raw);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({ label, count, ratio: count / total }));
}

function normalizeType(raw: string | undefined | null): string {
  if (!raw || raw.trim() === "") return "other";
  const t = raw.toLowerCase();
  if (t.includes("journal") || t.includes("article")) return "期刊论文";
  if (t.includes("conference") || t.includes("proceeding") || t.includes("workshop"))
    return "会议论文";
  if (t.includes("preprint") || t.includes("arxiv")) return "预印本";
  return "other";
}

/** 聚合来源分布（简写），按数量降序，最多取前 6 条。 */
export function buildSourceDist(papers: PaperReference[]): MiniChartBar[] {
  const counts = new Map<string, number>();
  for (const p of papers) {
    if (!p.source || p.source.trim() === "") continue;
    const abbr = abbreviateSource(p.source);
    counts.set(abbr, (counts.get(abbr) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const total = sorted.reduce((a, [, c]) => a + c, 0) || 1;
  return sorted.map(([label, count]) => ({ label, count, ratio: count / total }));
}
