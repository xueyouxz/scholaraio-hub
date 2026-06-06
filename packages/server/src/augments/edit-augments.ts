/**
 * Edit augment 服务——为 Edit tool_use 块计算 structuredPatch 和带语法高亮的 diff HTML。
 *
 * 该模块统一了待处理（tool_use）和已完成（tool_result）两种状态下的 unified diff 展示逻辑：
 * - 对拥有 old_string / new_string 的标准 Edit 调用，使用 jsdiff 直接计算结构化 patch；
 * - 对 Codex apply_patch 等原始 patch 格式，先解析成统一的 PatchHunk[] 再走同一条高亮管线；
 * - 高亮管线优先按文件扩展名用 Shiki 对源码做语法高亮，再叠加词级 diff 标记；
 *   语言未知或高亮失败时降级为纯 diff 高亮，再次失败时降级为转义纯文本。
 */

import type { EditAugment, PatchHunk } from "@scholaraio-hub/shared";
import { diffWordsWithSpace, structuredPatch } from "diff";
import { getLanguageForPath, highlightCode } from "../highlighting/index.js";

/** diff 上下文行数：每个变更区块前后各保留 3 行不变内容，方便阅读时定位改动位置 */
const CONTEXT_LINES = 3;

/**
 * 计算 edit augment 所需的输入，对应 Edit tool_use 的标准参数。
 */
export interface EditInput {
  file_path: string;
  old_string: string;
  new_string: string;
}

interface DiffHtmlInput {
  oldString: string;
  newString: string;
  hunks: PatchHunk[];
  filePath: string;
}

/**
 * 将 jsdiff 返回的 patch hunk 转换为项目内部的 PatchHunk 格式。
 * jsdiff hunk 结构与内部格式基本一致，主要差异是需要过滤掉
 * "\ No newline at end of file" 这类对 UI 展示无用的行。
 */
function convertHunks(
  hunks: Array<{
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    lines: string[];
  }>,
): PatchHunk[] {
  return hunks.map((hunk) => ({
    oldStart: hunk.oldStart,
    oldLines: hunk.oldLines,
    newStart: hunk.newStart,
    newLines: hunk.newLines,
    // 过滤掉 "\ No newline at end of file"，该行对前端展示无意义
    lines: hunk.lines.filter((line) => line !== "\\ No newline at end of file"),
  }));
}

/**
 * 将结构化 patch hunk 还原为 unified diff 纯文本。
 * 用于语法高亮降级路径：当按源码语言高亮失败时，将 diff 文本传给 Shiki 的 "diff" 语言高亮器。
 */
function patchToUnifiedText(hunks: PatchHunk[]): string {
  const lines: string[] = [];

  for (const hunk of hunks) {
    // 写入 hunk 头部，格式为标准 unified diff 的 @@ 行
    lines.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);
    // 写入 diff 行，每行已包含 ' '（上下文）、'-'（删除）或 '+'（新增）前缀
    lines.push(...hunk.lines);
  }

  return lines.join("\n");
}

/** 统计 hunk 行列表中属于旧文件（上下文行 + 删除行）的行数 */
function countOldLinesInHunk(lines: string[]): number {
  let count = 0;
  for (const line of lines) {
    const prefix = line[0];
    if (prefix === " " || prefix === "-") {
      count++;
    }
  }
  return count;
}

/** 统计 hunk 行列表中属于新文件（上下文行 + 新增行）的行数 */
function countNewLinesInHunk(lines: string[]): number {
  let count = 0;
  for (const line of lines) {
    const prefix = line[0];
    if (prefix === " " || prefix === "+") {
      count++;
    }
  }
  return count;
}

/**
 * 从 hunk 行重建合成 diff 输入（oldString / newString）。
 * 适用于只有 PatchHunk[] 而没有原始文件内容的场景（如 Codex apply_patch 持久化行），
 * 从 hunk 行逆向还原两侧字符串，再送入语法高亮管线。
 */
interface SyntheticDiffInput {
  oldString: string;
  newString: string;
  hunks: PatchHunk[];
}

/**
 * 从 PatchHunk[] 逆向构建合成 diff 输入。
 *
 * 遍历所有 hunk 行，将上下文行（' '）和删除行（'-'）合并为 oldString，
 * 将上下文行（' '）和新增行（'+'）合并为 newString，同时将 hunk 的行号
 * 重置为从第 1 行起连续编号，确保后续 Shiki 高亮时行索引对齐。
 */
function buildSyntheticDiffInput(hunks: PatchHunk[]): SyntheticDiffInput {
  const oldLines: string[] = [];
  const newLines: string[] = [];
  const normalizedHunks: PatchHunk[] = [];

  let nextOldStart = 1;
  let nextNewStart = 1;

  for (const hunk of hunks) {
    const filteredLines = hunk.lines.filter((line) => {
      const prefix = line[0];
      return prefix === " " || prefix === "-" || prefix === "+";
    });

    if (filteredLines.length === 0) {
      continue;
    }

    for (const line of filteredLines) {
      const prefix = line[0];
      const content = line.slice(1);

      if (prefix === " " || prefix === "-") {
        oldLines.push(content);
      }
      if (prefix === " " || prefix === "+") {
        newLines.push(content);
      }
    }

    const oldLinesCount = countOldLinesInHunk(filteredLines);
    const newLinesCount = countNewLinesInHunk(filteredLines);

    normalizedHunks.push({
      oldStart: nextOldStart,
      oldLines: oldLinesCount,
      newStart: nextNewStart,
      newLines: newLinesCount,
      lines: filteredLines,
    });

    nextOldStart += oldLinesCount;
    nextNewStart += newLinesCount;
  }

  return {
    oldString: oldLines.join("\n"),
    newString: newLines.join("\n"),
    hunks: normalizedHunks,
  };
}

/**
 * 从 Shiki 输出的 HTML 中提取每个 `<span class="line">` 的内部内容。
 *
 * Shiki 为每行代码生成一个 `<span class="line">...</span>`，内部可能嵌套多层
 * 语法着色 span。本函数通过深度计数追踪嵌套，精确定位每行的起止位置，
 * 返回每行的内层 HTML（不含外层 line span 标签自身），供后续拼接 diff 行时使用。
 */
function extractShikiLines(html: string): string[] {
  const lines: string[] = [];
  const lineStartRegex = /<span class="line">/g;
  let match: RegExpExecArray | null = lineStartRegex.exec(html);

  while (match !== null) {
    const startPos = match.index + match[0].length;
    let depth = 1;
    let pos = startPos;

    // 通过追踪 span 嵌套深度找到与起始 <span> 匹配的闭合 </span>
    while (depth > 0 && pos < html.length) {
      const nextOpen = html.indexOf("<span", pos);
      const nextClose = html.indexOf("</span>", pos);

      if (nextClose === -1) break;

      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        pos = nextOpen + 5; // 跳过 "<span"，5 个字符
      } else {
        depth--;
        if (depth === 0) {
          lines.push(html.slice(startPos, nextClose));
        }
        pos = nextClose + 7; // 跳过 "</span>"，7 个字符
      }
    }
    match = lineStartRegex.exec(html);
  }

  return lines;
}

/**
 * 一个 hunk 内各行的词级 diff 结果，以行绝对索引（0-based）为键。
 */
interface HunkWordDiffs {
  /** 旧文件行索引（在 oldLines 数组中的 0-based 绝对位置）→ 词级 diff 片段列表 */
  oldLineDiffs: Map<number, WordDiffSegment[]>;
  /** 新文件行索引（在 newLines 数组中的 0-based 绝对位置）→ 词级 diff 片段列表 */
  newLineDiffs: Map<number, WordDiffSegment[]>;
}

/**
 * 预计算单个 hunk 中所有替换行对的词级 diff。
 *
 * 遍历 hunk 行，将连续的删除行（'-'）和新增行（'+'）两两配对；
 * 对每个配对调用 computeWordDiff，若存在实际变更则以行的绝对索引为键
 * 存入返回的映射中，供 highlightDiffWithSyntax 在构建 diff HTML 时按行查找。
 *
 * @param hunk - 待处理的 patch hunk
 * @param hunkOldStartIdx - 该 hunk 旧文件起始行在 oldLines 数组中的 0-based 绝对索引
 * @param hunkNewStartIdx - 该 hunk 新文件起始行在 newLines 数组中的 0-based 绝对索引
 */
function computeHunkWordDiffs(
  hunk: PatchHunk,
  hunkOldStartIdx: number,
  hunkNewStartIdx: number,
): HunkWordDiffs {
  const oldLineDiffs = new Map<number, WordDiffSegment[]>();
  const newLineDiffs = new Map<number, WordDiffSegment[]>();

  // findReplacePairs 用于识别连续 -/+ 行对，此处只取配对结果（pairs 字段暂不使用，
  // 实际配对逻辑在下方的 flushPairs 中重新实现以携带绝对行索引）
  const { pairs } = findReplacePairs(hunk.lines);

  // 分别追踪旧文件和新文件的行偏移量，用于计算每行在全局 oldLines/newLines 数组中的绝对索引
  let oldOffset = 0;
  let newOffset = 0;
  let currentRemovals: Array<{ absIdx: number; text: string }> = [];
  let currentAdditions: Array<{ absIdx: number; text: string }> = [];

  const flushPairs = () => {
    const pairCount = Math.min(currentRemovals.length, currentAdditions.length);
    for (let i = 0; i < pairCount; i++) {
      const removal = currentRemovals[i];
      const addition = currentAdditions[i];
      if (removal && addition) {
        const wordDiff = computeWordDiff(removal.text, addition.text);
        // 仅在词级 diff 确实存在变更时才记录，纯相同的配对行无需标记
        const hasChanges = wordDiff.some((seg) => seg.type === "removed" || seg.type === "added");
        if (hasChanges) {
          oldLineDiffs.set(removal.absIdx, wordDiff);
          newLineDiffs.set(addition.absIdx, wordDiff);
        }
      }
    }
    currentRemovals = [];
    currentAdditions = [];
  };

  for (const line of hunk.lines) {
    const prefix = line[0];
    const text = line.slice(1);

    if (prefix === "-") {
      // 遇到新的删除行前若已有积累的新增行，先将当前组刷出配对
      if (currentAdditions.length > 0) {
        flushPairs();
      }
      currentRemovals.push({
        absIdx: hunkOldStartIdx + oldOffset,
        text,
      });
      oldOffset++;
    } else if (prefix === "+") {
      currentAdditions.push({
        absIdx: hunkNewStartIdx + newOffset,
        text,
      });
      newOffset++;
    } else if (prefix === " ") {
      // 上下文行：当前组结束，刷出配对并推进两侧偏移
      flushPairs();
      oldOffset++;
      newOffset++;
    } else if (line.startsWith("@@")) {
      // hunk 头部：重置当前组
      flushPairs();
    }
  }

  // 刷出行尾残余的未配对组
  flushPairs();

  return { oldLineDiffs, newLineDiffs };
}

/**
 * 用源码语言的语法高亮构建 diff HTML。
 *
 * 核心思路：分别对 oldString 和 newString 整体做 Shiki 语法高亮，再按 hunk 行顺序
 * 从对应侧取出已高亮的行，并叠加词级 diff 标记，最终拼合成带行类型 CSS 类的 HTML。
 * 这样既保留了语言级别的着色（关键字、字符串等），又能精确标出行内的增删词。
 *
 * @returns 高亮后的 HTML 字符串；文件扩展名未知或 Shiki 高亮失败时返回 null，
 *          调用方应降级为纯 diff 高亮。
 */
async function highlightDiffWithSyntax(
  oldString: string,
  newString: string,
  hunks: PatchHunk[],
  filePath: string,
): Promise<string | null> {
  // 根据文件扩展名识别语言；未知扩展名无法做源码高亮，直接返回 null 触发降级
  const lang = getLanguageForPath(filePath);
  if (!lang) return null;

  // 分别对旧版本和新版本整体高亮；空字符串时 highlightCode 返回 null，单独处理避免误判
  const oldResult = oldString.length > 0 ? await highlightCode(oldString, lang) : null;
  const newResult = newString.length > 0 ? await highlightCode(newString, lang) : null;

  // 非空字符串高亮失败（语言不支持或内部错误）时返回 null，触发降级
  if (!oldResult && oldString.length > 0) return null;
  if (!newResult && newString.length > 0) return null;

  // 从 Shiki HTML 中逐行提取内层高亮 HTML
  const oldLines = oldResult ? extractShikiLines(oldResult.html) : [];
  const newLines = newResult ? extractShikiLines(newResult.html) : [];

  // 预计算所有 hunk 的词级 diff，合并为全局映射供后续按行查找
  const allOldLineDiffs = new Map<number, WordDiffSegment[]>();
  const allNewLineDiffs = new Map<number, WordDiffSegment[]>();

  for (const hunk of hunks) {
    const hunkOldStartIdx = hunk.oldStart - 1; // 转为 0-based 索引
    const hunkNewStartIdx = hunk.newStart - 1;
    const { oldLineDiffs, newLineDiffs } = computeHunkWordDiffs(
      hunk,
      hunkOldStartIdx,
      hunkNewStartIdx,
    );

    // 合并到全局映射
    for (const [idx, diff] of oldLineDiffs) {
      allOldLineDiffs.set(idx, diff);
    }
    for (const [idx, diff] of newLineDiffs) {
      allNewLineDiffs.set(idx, diff);
    }
  }

  // 按 hunk 顺序拼合最终 diff HTML
  const resultLines: string[] = [];

  for (const hunk of hunks) {
    // hunk 头部行（CSS 可隐藏，但测试中需要用于定位）
    resultLines.push(
      `<span class="line line-hunk">@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@</span>`,
    );

    let oldIdx = hunk.oldStart - 1; // 0-based
    let newIdx = hunk.newStart - 1;

    for (const line of hunk.lines) {
      const prefix = line[0];
      let lineClass: string;
      let content: string;

      if (prefix === " ") {
        // 上下文行：旧新两侧内容相同，取旧侧高亮行即可
        lineClass = "line line-context";
        content = oldLines[oldIdx++] ?? "";
        newIdx++;
      } else if (prefix === "-") {
        // 删除行：取旧侧高亮行，若有词级 diff 则注入标记
        lineClass = "line line-deleted";
        content = oldLines[oldIdx] ?? "";
        const wordDiff = allOldLineDiffs.get(oldIdx);
        if (wordDiff) {
          content = injectWordDiffMarkers(content, wordDiff, "old");
        }
        oldIdx++;
      } else if (prefix === "+") {
        // 新增行：取新侧高亮行，若有词级 diff 则注入标记
        lineClass = "line line-inserted";
        content = newLines[newIdx] ?? "";
        const wordDiff = allNewLineDiffs.get(newIdx);
        if (wordDiff) {
          content = injectWordDiffMarkers(content, wordDiff, "new");
        }
        newIdx++;
      } else {
        continue; // 跳过不认识的前缀
      }

      resultLines.push(
        `<span class="${lineClass}"><span class="diff-prefix">${escapeHtml(prefix)}</span>${content}</span>`,
      );
    }
  }

  return `<pre class="shiki"><code class="language-${lang}">${resultLines.join("\n")}</code></pre>`;
}

/**
 * 带降级策略的 diff HTML 构建器，按以下优先级尝试三种渲染方式：
 * 1. 按源码语言语法高亮（highlightDiffWithSyntax）——效果最佳；
 * 2. 仅对 diff 文本做高亮（Shiki "diff" 语言）——语言未知时的备选；
 * 3. 转义纯文本包裹在 `<pre><code>` 中——最后保底方案。
 */
async function buildDiffHtmlWithFallback({
  oldString,
  newString,
  hunks,
  filePath,
}: DiffHtmlInput): Promise<string> {
  // 优先尝试按源码语言做语法高亮 diff
  let diffHtml = await highlightDiffWithSyntax(oldString, newString, hunks, filePath);

  if (!diffHtml) {
    // 语法高亮不可用时，将 hunk 还原为 unified diff 文本交给 Shiki 的 diff 语言处理器
    const diffText = patchToUnifiedText(hunks);
    const highlightResult = await highlightCode(diffText, "diff");
    if (highlightResult) {
      // 后处理：给每行加上行类型 CSS 类，使背景色与源码语言高亮路径保持一致
      diffHtml = addDiffLineClasses(highlightResult.html);
    } else {
      // 最终降级：输出转义纯文本，确保任何情况下都能展示内容
      diffHtml = `<pre class="shiki"><code class="language-diff">${escapeHtml(diffText)}</code></pre>`;
    }
  }

  return diffHtml;
}

/**
 * 从结构化 patch（PatchHunk[]）直接计算 diff HTML，无需原始文件内容。
 *
 * 适用于历史会话中已持久化的 Codex apply_patch 行：这类记录只有 hunk 数据
 * 而没有完整的 old_string / new_string，通过 buildSyntheticDiffInput 逆向
 * 重建两侧字符串后走统一的高亮管线。
 *
 * @returns 高亮 HTML 字符串，patch 为空时返回 null
 */
export async function computeStructuredPatchDiffHtml(
  filePath: string,
  structuredPatch: PatchHunk[],
): Promise<string | null> {
  if (structuredPatch.length === 0) {
    return null;
  }

  const synthetic = buildSyntheticDiffInput(structuredPatch);
  if (synthetic.hunks.length === 0) {
    return null;
  }

  return buildDiffHtmlWithFallback({
    oldString: synthetic.oldString,
    newString: synthetic.newString,
    hunks: synthetic.hunks,
    filePath,
  });
}

/**
 * 为 Edit tool_use 块计算完整的 edit augment。
 *
 * 这是标准 Edit 调用（带有 old_string / new_string）的主入口：
 * 使用 jsdiff 计算结构化 patch，再经 buildDiffHtmlWithFallback 生成高亮 HTML，
 * 最终将两者打包为 EditAugment 返回，供前端直接渲染。
 *
 * @param toolUseId - 关联的 tool_use 块 ID，用于前端按 ID 查找对应 augment
 * @param input - Edit 工具的输入参数：file_path、old_string、new_string
 * @param contextLines - diff 上下文行数，默认 3
 * @returns 包含 structuredPatch 和高亮 diffHtml 的 EditAugment
 */
export async function computeEditAugment(
  toolUseId: string,
  input: EditInput,
  contextLines: number = CONTEXT_LINES,
): Promise<EditAugment> {
  const { file_path, old_string, new_string } = input;

  // 使用 jsdiff 计算 unified diff，得到结构化 hunk 数组
  const patch = structuredPatch(
    file_path,
    file_path,
    old_string,
    new_string,
    "", // oldHeader（不需要文件头注释）
    "", // newHeader
    { context: contextLines },
  );

  // 转换为内部 PatchHunk 格式
  const structuredPatchResult = convertHunks(patch.hunks);

  const diffHtml = await buildDiffHtmlWithFallback({
    oldString: old_string,
    newString: new_string,
    hunks: structuredPatchResult,
    filePath: file_path,
  });

  return {
    toolUseId,
    type: "edit",
    structuredPatch: structuredPatchResult,
    diffHtml,
    filePath: file_path,
  };
}

/**
 * 为 Shiki 输出的 diff HTML 中每行添加行类型 CSS 类。
 *
 * Shiki 用 "diff" 语言高亮时只产出通用的 `<span class="line">`，
 * 本函数检测每行可见文本的第一个字符，将其替换为带语义类的版本：
 * - `-` → `line-deleted`（删除行，红色背景）
 * - `+` → `line-inserted`（新增行，绿色背景）
 * - `@` → `line-hunk`（hunk 头部，灰色背景）
 * - ` ` → `line-context`（上下文行，无特殊背景）
 *
 * 与 highlightDiffWithSyntax 保持相同的类名约定，确保 CSS 样式通用。
 */
function addDiffLineClasses(html: string): string {
  // 匹配每个 `<span class="line">...</span>`，检查其可见文本的首字符
  return html.replace(/<span class="line">([\s\S]*?)<\/span>/g, (_match, content: string) => {
    // 先解码 HTML 实体，再剥离标签，得到实际的可见文本首字符
    const decoded = content.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    const textContent = decoded.replace(/<[^>]*>/g, "");
    const firstChar = textContent[0];

    let lineClass = "line";
    if (firstChar === "-") {
      lineClass = "line line-deleted";
    } else if (firstChar === "+") {
      lineClass = "line line-inserted";
    } else if (firstChar === "@") {
      lineClass = "line line-hunk";
    } else if (firstChar === " ") {
      lineClass = "line line-context";
    }

    return `<span class="${lineClass}">${content}</span>`;
  });
}

/** 转义 HTML 特殊字符，用于降级渲染时将代码内容安全插入 HTML */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * 替换 hunk 中一对被修改的行（旧行 → 新行），用于词级 diff 配对。
 */
interface LinePair {
  oldLineIndex: number; // 在当前删除行组中的 0-based 相对索引
  newLineIndex: number; // 在当前新增行组中的 0-based 相对索引
  oldText: string; // 旧行文本（去掉 '-' 前缀）
  newText: string; // 新行文本（去掉 '+' 前缀）
}

/**
 * 分析单个 hunk 后得到的替换行配对结果。
 */
interface HunkReplacePairs {
  pairs: LinePair[];
  /** 无法配对的多余删除行（删除行数 > 新增行数时出现） */
  unpairedRemovals: Array<{ index: number; text: string }>;
  /** 无法配对的多余新增行（新增行数 > 删除行数时出现） */
  unpairedAdditions: Array<{ index: number; text: string }>;
}

/**
 * 在 hunk 行中找出连续的 -/+ 行对，这些行对代表"被替换的行"，是词级 diff 的候选。
 *
 * 配对策略：
 * - 按出现顺序将删除行与新增行一一匹配（第 1 个 '-' 与第 1 个 '+' 配对，以此类推）；
 * - 删除行多于新增行时，多余的删除行记为未配对；反之亦然；
 * - 上下文行（空格前缀）或 hunk 头部（@@）会重置当前配对组。
 *
 * @param hunkLines - hunk 行数组，每行以 ' '、'-'、'+' 或 '@@' 开头
 * @returns 配对结果及未配对行
 */
function findReplacePairs(hunkLines: string[]): HunkReplacePairs {
  const result: HunkReplacePairs = {
    pairs: [],
    unpairedRemovals: [],
    unpairedAdditions: [],
  };

  // 暂存当前连续删除/新增组，遇到分隔符时统一配对
  let currentRemovals: Array<{ index: number; text: string }> = [];
  let currentAdditions: Array<{ index: number; text: string }> = [];

  /**
   * 将当前积累的删除行与新增行按顺序配对，多余的行记为未配对，然后清空缓存。
   */
  function flushGroup() {
    const pairCount = Math.min(currentRemovals.length, currentAdditions.length);

    for (let i = 0; i < pairCount; i++) {
      const removal = currentRemovals[i];
      const addition = currentAdditions[i];
      if (removal && addition) {
        result.pairs.push({
          oldLineIndex: i,
          newLineIndex: i,
          oldText: removal.text,
          newText: addition.text,
        });
      }
    }

    // 删除行比新增行多时，多余的删除行无法配对
    for (let i = pairCount; i < currentRemovals.length; i++) {
      const removal = currentRemovals[i];
      if (removal) {
        result.unpairedRemovals.push(removal);
      }
    }

    // 新增行比删除行多时，多余的新增行无法配对
    for (let i = pairCount; i < currentAdditions.length; i++) {
      const addition = currentAdditions[i];
      if (addition) {
        result.unpairedAdditions.push(addition);
      }
    }

    currentRemovals = [];
    currentAdditions = [];
  }

  for (const line of hunkLines) {
    const prefix = line[0];

    if (prefix === "-") {
      // 删除行之前若已有新增行（+ 后跟 -），说明进入新组，先刷出上一组
      if (currentAdditions.length > 0) {
        flushGroup();
      }
      currentRemovals.push({
        index: currentRemovals.length,
        text: line.slice(1),
      });
    } else if (prefix === "+") {
      // 新增行直接追加到当前组（- 后跟 + 是正常的替换模式）
      currentAdditions.push({
        index: currentAdditions.length,
        text: line.slice(1),
      });
    } else if (prefix === " " || line.startsWith("@@")) {
      // 上下文行或 hunk 头部：当前组结束，刷出配对并重置
      flushGroup();
    }
    // "\ No newline at end of file" 等其他行直接跳过
  }

  // 刷出末尾残余组
  flushGroup();

  return result;
}

/**
 * 词级 diff 的单个片段，描述两行之间某段文本的变更状态。
 */
export interface WordDiffSegment {
  text: string;
  type: "unchanged" | "removed" | "added";
}

/**
 * 计算两行之间的词级 diff。
 *
 * 使用 jsdiff 的 diffWordsWithSpace（而非 diffWords），区别在于：
 * diffWordsWithSpace 将空白字符视为有意义的内容，
 * 因此当只有词语变化时，行首缩进会被标记为"未变"而非"删除+新增"。
 * 这对代码 diff 而言更准确，避免缩进变化淹没真正的词语变化。
 *
 * @param oldLine - 旧行文本（不含 '-' 前缀）
 * @param newLine - 新行文本（不含 '+' 前缀）
 * @returns 词级 diff 片段数组
 */
function computeWordDiff(oldLine: string, newLine: string): WordDiffSegment[] {
  const changes = diffWordsWithSpace(oldLine, newLine);

  return changes.map((change) => ({
    text: change.value,
    type: change.added ? "added" : change.removed ? "removed" : "unchanged",
  }));
}

/** 常用 HTML 命名实体到原始字符的映射表，用于词级 diff 注入时对齐纯文本与 HTML 偏移 */
const HTML_ENTITY_MAP: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&amp;": "&",
  "&quot;": '"',
  "&#039;": "'",
  "&apos;": "'",
};

/**
 * HTML 段，表示一段纯文本内容或一个 HTML 标签。
 * 用于在保持 HTML 结构完整的同时，将词级 diff 标记注入到语法高亮 HTML 中。
 */
interface HtmlSegment {
  type: "text" | "tag";
  content: string;
  /** 仅文本段有效：content 中 HTML 实体解码后的纯文本，用于与词级 diff 文本对齐 */
  plainText?: string;
}

/**
 * 将 HTML 字符串拆分为文本段和标签段的交替序列。
 *
 * 文本段的 plainText 字段预先解码了 HTML 实体，便于后续按字符数与
 * 词级 diff 文本对齐；content 字段保留原始 HTML 编码，用于输出时原样拼接。
 */
function parseHtmlSegments(html: string): HtmlSegment[] {
  const segments: HtmlSegment[] = [];
  const tagRegex = /<[^>]*>/g;
  let lastIndex = 0;

  for (const match of html.matchAll(tagRegex)) {
    // 标签前的文本内容
    if (match.index > lastIndex) {
      const content = html.slice(lastIndex, match.index);
      segments.push({
        type: "text",
        content,
        plainText: decodeHtmlEntities(content),
      });
    }

    // 标签本身（开始标签、结束标签或自闭合标签）
    segments.push({
      type: "tag",
      content: match[0],
    });

    lastIndex = match.index + match[0].length;
  }

  // 最后一个标签之后的剩余文本
  if (lastIndex < html.length) {
    const content = html.slice(lastIndex);
    segments.push({
      type: "text",
      content,
      plainText: decodeHtmlEntities(content),
    });
  }

  return segments;
}

/**
 * 将 HTML 实体解码为对应的纯文本字符。
 * 支持命名实体（&lt;）、十进制数字实体（&#60;）和十六进制数字实体（&#x3C;）。
 */
function decodeHtmlEntities(html: string): string {
  return html.replace(/&[^;]+;/g, (entity) => {
    // 先查命名实体映射表
    if (HTML_ENTITY_MAP[entity]) {
      return HTML_ENTITY_MAP[entity];
    }

    // 处理数字实体：&#60;（十进制）或 &#x3C;（十六进制）
    if (entity.startsWith("&#")) {
      const isHex = entity[2] === "x" || entity[2] === "X";
      const numStr = isHex ? entity.slice(3, -1) : entity.slice(2, -1);
      const codePoint = Number.parseInt(numStr, isHex ? 16 : 10);
      if (!Number.isNaN(codePoint)) {
        return String.fromCodePoint(codePoint);
      }
    }

    // 无法识别的实体保持原样
    return entity;
  });
}

/**
 * 将词级 diff 标记注入到语法高亮 HTML 中，同时不破坏 Shiki 产生的 span 嵌套结构。
 *
 * 核心问题：Shiki 按语法着色生成嵌套 span，而词级 diff 是按字符区间划分的；
 * 两者的边界往往不对齐。本函数同步遍历词级 diff 片段和 HTML 段（文本/标签交替），
 * 对需要高亮的字符区间包裹 `<span class="diff-word-removed/added">`，
 * 遇到中间的 HTML 标签时先关闭高亮 span、输出标签、再重新开启，
 * 确保最终 HTML 结构合法。
 *
 * @param html - 单行的语法高亮 HTML（`<span class="line">` 的内层内容）
 * @param wordDiff - computeWordDiff() 返回的词级 diff 片段列表
 * @param mode - 'old' 表示处理删除行（标记 removed 片段），'new' 表示处理新增行（标记 added 片段）
 * @returns 注入了词级 diff 标记的 HTML 字符串
 */
function injectWordDiffMarkers(
  html: string,
  wordDiff: WordDiffSegment[],
  mode: "old" | "new",
): string {
  // 根据模式确定需要高亮的片段类型和对应 CSS 类
  const targetType = mode === "old" ? "removed" : "added";
  const cssClass = mode === "old" ? "diff-word-removed" : "diff-word-added";

  // 筛选出当前模式下应出现在 HTML 中的片段：
  // old 模式 → 保留 unchanged + removed；new 模式 → 保留 unchanged + added
  const relevantSegments = wordDiff.filter(
    (seg) => seg.type === "unchanged" || seg.type === targetType,
  );

  // 将 HTML 拆分为文本段和标签段，方便按字符数推进
  const htmlSegments = parseHtmlSegments(html);

  const result: string[] = [];
  let htmlSegmentIndex = 0;
  let htmlTextOffset = 0; // 当前文本段内已消费的纯文本字符数

  for (const segment of relevantSegments) {
    const segmentText = segment.text;
    let remaining = segmentText.length;
    const needsHighlight = segment.type === targetType;

    // 累积需要包裹在高亮 span 内的 HTML 片段
    let highlightParts: string[] = [];

    while (remaining > 0) {
      const htmlSeg = htmlSegments[htmlSegmentIndex];
      if (!htmlSeg) break;

      if (htmlSeg.type === "tag") {
        // 标签原样透传；若当前正在积累高亮内容，先关闭高亮 span 再输出标签
        if (needsHighlight && highlightParts.length > 0) {
          result.push(`<span class="${cssClass}">${highlightParts.join("")}</span>`);
          highlightParts = [];
        }
        result.push(htmlSeg.content);
        htmlSegmentIndex++;
        continue;
      }

      // 文本段：按需取出所需字符数
      const plainText = htmlSeg.plainText ?? "";
      const availableText = plainText.slice(htmlTextOffset);
      const availableLen = availableText.length;

      if (availableLen === 0) {
        // 当前文本段已耗尽，移到下一段
        htmlSegmentIndex++;
        htmlTextOffset = 0;
        continue;
      }

      const takeLen = Math.min(remaining, availableLen);

      // 将纯文本区间映射回原始 HTML（含实体编码），确保输出时实体不被双重编码
      const takenHtml = convertPlainTextToHtml(
        htmlSeg.content,
        htmlTextOffset,
        availableText.slice(0, takeLen),
      );

      if (needsHighlight) {
        highlightParts.push(takenHtml);
      } else {
        result.push(takenHtml);
      }

      remaining -= takeLen;
      htmlTextOffset += takeLen;

      if (htmlTextOffset >= plainText.length) {
        htmlSegmentIndex++;
        htmlTextOffset = 0;
      }
    }

    // 片段处理完毕后刷出剩余的高亮积累
    if (needsHighlight && highlightParts.length > 0) {
      result.push(`<span class="${cssClass}">${highlightParts.join("")}</span>`);
    }
  }

  // 追加所有文本已消费后剩余的 HTML 段（通常是行尾的闭合标签）
  for (let i = htmlSegmentIndex; i < htmlSegments.length; i++) {
    const htmlSeg = htmlSegments[i];
    if (!htmlSeg) continue;

    if (htmlSeg.type === "tag") {
      result.push(htmlSeg.content);
    } else if (i === htmlSegmentIndex && htmlTextOffset > 0) {
      // 当前文本段仅部分消费，输出剩余部分
      const remainingText = (htmlSeg.plainText ?? "").slice(htmlTextOffset);
      if (remainingText.length > 0) {
        result.push(
          htmlSeg.content.slice(findHtmlOffsetForPlainTextOffset(htmlSeg.content, htmlTextOffset)),
        );
      }
    } else {
      // 完整文本段直接输出
      result.push(htmlSeg.content);
    }
  }

  return result.join("");
}

/**
 * 将纯文本区间还原为其在原始 HTML 中对应的子字符串（含实体编码）。
 *
 * 由于 Shiki 输出的 HTML 中 `<`、`>`、`&` 等字符被编码为实体，
 * 若直接按字符数截取 HTML 会产生偏移错误。本函数通过
 * findHtmlOffsetForPlainTextOffset 将纯文本偏移映射回 HTML 偏移，
 * 保证实体完整、不被截断。
 *
 * @param originalHtml - 原始 HTML 文本段（可能含实体编码，不含子标签）
 * @param startPlainOffset - 目标区间在解码纯文本中的起始偏移（字符数）
 * @param plainText - 需要还原的纯文本片段
 * @returns 对应的原始 HTML 子字符串
 */
function convertPlainTextToHtml(
  originalHtml: string,
  startPlainOffset: number,
  plainText: string,
): string {
  const htmlStart = findHtmlOffsetForPlainTextOffset(originalHtml, startPlainOffset);
  const htmlEnd = findHtmlOffsetForPlainTextOffset(
    originalHtml,
    startPlainOffset + plainText.length,
  );
  return originalHtml.slice(htmlStart, htmlEnd);
}

/**
 * 判断给定字符串是否是一个能解码为单个字符的合法 HTML 实体。
 * 支持命名实体（来自 HTML_ENTITY_MAP）、十进制数字实体（&#60;）和十六进制数字实体（&#x3C;）。
 */
function isValidHtmlEntity(entity: string): boolean {
  if (HTML_ENTITY_MAP[entity]) {
    return true;
  }

  // 数字实体：&#60;（十进制）或 &#x3C;（十六进制）
  if (entity.startsWith("&#")) {
    const isHex = entity[2] === "x" || entity[2] === "X";
    const numStr = isHex ? entity.slice(3, -1) : entity.slice(2, -1);
    const codePoint = Number.parseInt(numStr, isHex ? 16 : 10);
    return !Number.isNaN(codePoint);
  }

  return false;
}

/**
 * 将解码纯文本中的字符偏移量映射回原始 HTML 字符串中的字节偏移量。
 *
 * HTML 中的实体（如 `&lt;`）在纯文本中只占 1 个字符，但在 HTML 中占多个字节；
 * 本函数逐字符推进，遇到实体时整体跳过并只计 1 个纯文本字符，
 * 从而保证截取 HTML 子串时实体不被从中间截断。
 *
 * @param html - 含实体的 HTML 文本段（不含子标签）
 * @param plainOffset - 目标位置在解码纯文本中的字符数偏移
 * @returns 对应的 HTML 字符串字节偏移
 */
function findHtmlOffsetForPlainTextOffset(html: string, plainOffset: number): number {
  let htmlPos = 0;
  let plainPos = 0;

  while (plainPos < plainOffset && htmlPos < html.length) {
    // 检测 HTML 实体：以 '&' 开头，找到对应的 ';' 后整体视为 1 个字符
    if (html[htmlPos] === "&") {
      const semiPos = html.indexOf(";", htmlPos);
      if (semiPos !== -1) {
        const entity = html.slice(htmlPos, semiPos + 1);
        if (isValidHtmlEntity(entity)) {
          htmlPos = semiPos + 1;
          plainPos++;
          continue;
        }
      }
    }

    // 普通字符，HTML 位置和纯文本位置同步推进
    htmlPos++;
    plainPos++;
  }

  return htmlPos;
}

/**
 * @internal
 * 仅供测试使用，不得在生产代码中直接调用。
 */
export const __test__ = {
  extractShikiLines,
  addDiffLineClasses,
  convertHunks,
  patchToUnifiedText,
  buildSyntheticDiffInput,
  escapeHtml,
  computeWordDiff,
  findReplacePairs,
  injectWordDiffMarkers,
};
