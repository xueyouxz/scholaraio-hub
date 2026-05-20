import type { ScholarPaper } from "../../core/api";
import type { PaperReference, YearGroup } from "./types";

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
  return `/api/scholar/api/v1/papers/${encodeURIComponent(paperId)}/pdf`;
}

/** 构建文献图片的 API 访问 URL（对应 paper.md 中的 images/ 相对路径）。 */
export function buildPaperImageUrl(paperId: string, filename: string): string {
  return `/api/scholar/api/v1/papers/${encodeURIComponent(paperId)}/images/${encodeURIComponent(filename)}`;
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
