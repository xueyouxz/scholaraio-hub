/**
 * AugmentGenerator - 将已完成的 Markdown 块渲染为 HTML。
 *
 * 该模块负责把 block-detector 识别出来的结构化块转换成前端可直接插入的
 * HTML 片段。代码块使用 Shiki 做语法高亮，其他 Markdown 内容交给安全渲染
 * 管线处理；对于仍在流式输出中的未完成文本，则使用轻量级内联格式化，避免
 * 等完整块结束后才更新界面。
 */

import { type BundledLanguage, type Highlighter, bundledLanguages, createHighlighter } from "shiki";
import { createCssVariablesTheme } from "shiki/core";
import type { CompletedBlock, StreamingCodeBlock, StreamingList } from "./block-detector.js";
import {
  MEDIA_EXTENSIONS,
  VIDEO_EXTENSIONS,
  isLocalFilePath,
  localFileApiUrl,
  renderSafeMarkdown,
  sanitizeUrl,
} from "./safe-markdown.js";

/** CSS 变量主题：Shiki 会输出 `style="color: var(--shiki-...)"`，便于前端适配明暗主题。 */
const cssVarsTheme = createCssVariablesTheme({
  name: "css-variables",
  variablePrefix: "--shiki-",
  fontStyle: true,
});

export interface Augment {
  blockIndex: number;
  html: string;
  type: CompletedBlock["type"];
}

export interface AugmentGeneratorConfig {
  // 预加载的 Shiki 语言列表；预加载后同步高亮路径可以避免首次渲染时再解析语言包。
  languages: string[];
}

export interface AugmentGenerator {
  processBlock(block: CompletedBlock, blockIndex: number): Promise<Augment>;
  // 对尾部尚未归入完整块的文本进行轻量格式化，保证流式输出时也能显示粗体、链接等常见样式。
  renderPending(pending: string): string;
  // 对尚未闭合的代码块进行乐观渲染；后续完整块到达时会被正式渲染结果替换。
  renderStreamingCodeBlock(block: StreamingCodeBlock, blockIndex: number): Promise<Augment>;
  // 对尚未结束的列表进行乐观渲染，让列表项在流式输出期间保持结构化展示。
  renderStreamingList(block: StreamingList, blockIndex: number): Augment;
}

/**
 * 创建带有预加载语法高亮能力的 AugmentGenerator 实例。
 *
 * @param config - 语言预加载配置；无有效语言时会回退到 JavaScript 和 TypeScript。
 * @returns 解析为 AugmentGenerator 的 Promise，调用方可用它处理完整块和流式块。
 */
export async function createAugmentGenerator(
  config: AugmentGeneratorConfig,
): Promise<AugmentGenerator> {
  // 只保留 Shiki 内置语言中真实存在的条目，避免初始化时因为未知语言失败。
  const validLanguages = config.languages.filter(
    (lang) => lang in bundledLanguages,
  ) as BundledLanguage[];

  // 使用 CSS 变量主题创建高亮器，具体颜色交给前端主题变量决定，从而支持明暗主题切换。
  const highlighter = await createHighlighter({
    themes: [cssVarsTheme],
    langs: validLanguages.length > 0 ? validLanguages : ["javascript", "typescript"],
  });

  // 记录已加载语言，后续渲染时可判断是否需要动态补载语言包。
  const loadedLanguages = new Set<string>(validLanguages);

  return {
    async processBlock(block: CompletedBlock, blockIndex: number): Promise<Augment> {
      if (block.type === "code") {
        const html = await renderCodeBlock(block, highlighter, loadedLanguages);
        return { blockIndex, html, type: block.type };
      }

      const html = renderMarkdownBlock(block);
      return { blockIndex, html, type: block.type };
    },

    renderPending(pending: string): string {
      return renderInlineFormatting(pending);
    },

    async renderStreamingCodeBlock(
      block: StreamingCodeBlock,
      blockIndex: number,
    ): Promise<Augment> {
      const code = extractStreamingCodeContent(block.content);
      const lang = block.lang ?? "";

      const html = await renderCodeWithHighlighter(code, lang, highlighter, loadedLanguages);
      return { blockIndex, html, type: "code" };
    },

    renderStreamingList(block: StreamingList, blockIndex: number): Augment {
      const html = renderMarkdownBlock({
        type: "list",
        content: block.content,
        startOffset: block.startOffset,
        endOffset: block.startOffset + block.content.length,
      });
      return { blockIndex, html, type: "list" };
    },
  };
}

/**
 * 从完整代码块中提取代码正文，并移除首尾围栏标记。
 *
 * block-detector 传入的内容仍包含 ``` 或 ~~~ 围栏；这里保留中间所有代码行，
 * 如果末尾存在闭合围栏则一并去掉，确保 Shiki 接收到的只是可高亮的源码文本。
 */
function extractCodeContent(content: string): string {
  const lines = content.split("\n");
  if (lines.length < 2) return "";

  // 去掉第一行起始围栏；如果最后一行是闭合围栏，也从源码内容中排除。
  const hasClosingFence =
    lines.length > 1 && /^(`{3,}|~{3,})$/.test((lines[lines.length - 1] ?? "").trim());

  const codeLines = hasClosingFence ? lines.slice(1, -1) : lines.slice(1);

  return codeLines.join("\n");
}

/**
 * 从流式代码块中提取代码正文。
 *
 * 流式代码块通常还没有输出闭合围栏，因此这里只移除第一行起始围栏，保留之后
 * 已经到达的所有内容，方便界面在代码仍生成时持续预览高亮结果。
 */
function extractStreamingCodeContent(content: string): string {
  const lines = content.split("\n");
  if (lines.length < 2) return "";

  // 只移除第一行起始围栏，其余内容即使尚不完整也用于乐观渲染。
  return lines.slice(1).join("\n");
}

/**
 * 使用语法高亮渲染代码。
 *
 * 完整代码块和流式代码块共用该逻辑：优先使用已加载或可动态加载的 Shiki 语言；
 * 如果语言未知、加载失败或高亮过程抛错，则降级为普通 `<pre><code>`，避免单个
 * 代码块破坏整段 Markdown 的渲染。
 */
async function renderCodeWithHighlighter(
  code: string,
  lang: string,
  highlighter: Highlighter,
  loadedLanguages: Set<string>,
): Promise<string> {
  // 先确认语言是否是 Shiki 支持的内置语言；空语言和未知语言都按纯文本处理。
  const isValidLang = lang && lang in bundledLanguages;

  if (isValidLang && !loadedLanguages.has(lang)) {
    // 对未预加载但有效的语言进行按需加载，减少初始化成本，同时覆盖更多代码块类型。
    try {
      await highlighter.loadLanguage(lang as BundledLanguage);
      loadedLanguages.add(lang);
    } catch {
      // 语言包加载失败时降级为纯文本，保证调用方仍能得到可显示的 HTML。
      return renderPlainCodeBlock(code, lang);
    }
  }

  if (isValidLang && loadedLanguages.has(lang)) {
    try {
      const html = highlighter.codeToHtml(code, {
        lang: lang as BundledLanguage,
        theme: "css-variables",
      });
      return html;
    } catch {
      // 高亮过程失败时同样降级为纯文本，避免渲染链路中断。
      return renderPlainCodeBlock(code, lang);
    }
  }

  // 未知语言或未声明语言时，不做语法高亮，仅输出已转义的普通代码块。
  return renderPlainCodeBlock(code, lang);
}

/**
 * 渲染完整代码块。
 *
 * 该函数只负责从 CompletedBlock 提取语言和源码，实际高亮与降级策略统一交给
 * renderCodeWithHighlighter，保持完整块和流式块的输出一致。
 */
async function renderCodeBlock(
  block: CompletedBlock,
  highlighter: Highlighter,
  loadedLanguages: Set<string>,
): Promise<string> {
  const code = extractCodeContent(block.content);
  const lang = block.lang ?? "";
  return renderCodeWithHighlighter(code, lang, highlighter, loadedLanguages);
}

/**
 * 渲染不带语法高亮的普通代码块。
 *
 * 所有代码内容和语言类名都会先做 HTML 转义，防止代码文本中的特殊字符被浏览器
 * 当作真实标签或属性解释。
 */
function renderPlainCodeBlock(code: string, lang: string): string {
  const escapedCode = escapeHtml(code);
  const langClass = lang ? ` class="language-${escapeHtml(lang)}"` : "";
  return `<pre class="shiki"><code${langClass}>${escapedCode}</code></pre>`;
}

/**
 * 渲染非代码 Markdown 块。
 *
 * 这里统一走 renderSafeMarkdown，确保原始 HTML 被禁用并经过安全过滤；调用方不需要
 * 分别处理段落、标题、引用或列表等具体 Markdown 类型。
 */
function renderMarkdownBlock(block: CompletedBlock): string {
  return renderSafeMarkdown(block.content);
}

/**
 * 为待完成的流式文本渲染轻量级内联格式。
 *
 * 该路径不会运行完整 Markdown 解析器，只处理常见且边界清晰的内联语法：
 * `**bold**`、`*italic*`、`` `code` `` 和 `[text](url)`。这样可以在生成过程中
 * 快速更新尾部文本，同时避免未闭合块导致完整 Markdown 解析结果频繁抖动。
 */
function renderInlineFormatting(text: string): string {
  // 先转义 HTML，再插入受控标签，防止流式文本中的原始标签进入页面。
  let result = escapeHtml(text);

  // 粗体：**text**
  result = result.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

  // 斜体：*text*。使用负向断言避开粗体标记内部的星号，减少误匹配。
  result = result.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");

  // 行内代码：`text`
  result = result.replace(/`([^`]+)`/g, "<code>$1</code>");

  // 链接：[text](url)。本地文件路径会转换成受控 API URL，普通 URL 则先经过安全校验。
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, href) => {
    if (isLocalFilePath(href)) {
      const ext = (href.split(".").pop() ?? "").toLowerCase();
      const apiUrl = escapeHtml(localFileApiUrl(href));
      if (MEDIA_EXTENSIONS.has(ext)) {
        // 本地图片和视频额外标记媒体类型，供前端展示预览或采用差异化样式。
        const mediaType = VIDEO_EXTENSIONS.has(ext) ? "video" : "image";
        const typeLabel = VIDEO_EXTENSIONS.has(ext) ? "video" : "image";
        return `<a href="${apiUrl}" class="local-media-link" data-media-type="${mediaType}">${label}<span class="local-media-type">(${typeLabel})</span></a>`;
      }
      return `<a href="${apiUrl}">${label}</a>`;
    }
    const safeHref = sanitizeUrl(href);
    if (!safeHref) {
      return `[${label}](${href})`;
    }

    return `<a href="${escapeHtml(safeHref)}">${label}</a>`;
  });

  return result;
}

/**
 * 转义 HTML 特殊字符。
 *
 * 所有来自模型输出或文件内容的文本在拼接 HTML 前都应经过该函数，避免 `&`、尖括号、
 * 引号等字符改变最终 DOM 结构。
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
