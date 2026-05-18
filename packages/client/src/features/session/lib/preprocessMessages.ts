import type { MarkdownAugment, SessionContentBlock, SessionMessage } from "../model";
import { getMessageId } from "../model";
import { canonicalizeToolName, isToolGroupingDisabled } from "../renderers/tools/toolMetadata";
import type {
  RenderItem,
  SessionSetupItem,
  SystemItem,
  ToolCallItem,
  ToolGroupItem,
  ToolResultData,
  UserPromptItem,
} from "../types/renderItems";

type Message = SessionMessage;
type ContentBlock = SessionContentBlock;

/**
 * 表示当前会话是否存在活跃的工具审批请求。
 *
 * 为 true 时，缺少 tool_result 的工具调用不会被当成 interrupted/orphaned，
 * 而是继续显示为 pending。这样可以覆盖“服务端队列里有多个待审批工具”的场景：
 * 客户端通常只收到第一个审批请求，但后续工具也可能已经在服务端排队等待审批。
 */
export type ActiveToolApproval = boolean;

/**
 * 预处理阶段可注入到 RenderItem 的增强信息。
 *
 * 目前主要用于服务端预渲染 markdown。完成态 assistant 消息可能已经在服务端
 * 转成 HTML，前端在这里把 HTML 贴到对应 text item 上，避免再次解析 markdown。
 */
export interface PreprocessAugments {
  /** 按 messageId 索引的服务端预渲染 markdown HTML。 */
  markdown?: Record<string, MarkdownAugment>;
  /** 当前是否有活跃审批。存在审批时，缺少结果的 tool_use 不会被标记为 aborted。 */
  activeToolApproval?: ActiveToolApproval;
}

/**
 * 把原始 SDK/JSONL 消息预处理成 UI 可以直接渲染的 RenderItem。
 *
 * 这里会完成几件核心工作：
 * - 把 assistant 的 text/thinking/tool_use block 拆成独立渲染项；
 * - 把 user 消息里的 tool_result 回填到之前的 tool_use 上；
 * - 把系统初始化提示折叠成 session_setup；
 * - 把服务端预渲染的 markdown HTML 绑定到 text item。
 *
 * 这是纯函数：相同输入会得到相同输出。组件中可以配合 useMemo 在每次渲染时安全调用。
 */
export function preprocessMessages(
  messages: Message[],
  augments?: PreprocessAugments,
): RenderItem[] {
  const items: RenderItem[] = [];
  const toolCallIndices = new Map<string, number>(); // tool_use_id → items 中的渲染项位置。
  const pendingToolCalls = new Map<string, number>(); // 仍在等待 tool_result 的 tool_use 位置。

  // 收集服务端 DAG 过滤标记出的孤儿工具调用。
  // 如果当前有活跃审批，则跳过孤儿判断：没有结果的工具可能只是正在审批或排队，
  // 不能误显示为 interrupted。
  const orphanedToolIds = new Set<string>();
  if (!augments?.activeToolApproval) {
    for (const msg of messages) {
      const orphans = (msg as { orphanedToolUseIds?: unknown }).orphanedToolUseIds;
      if (Array.isArray(orphans)) {
        for (const id of orphans) {
          if (typeof id === "string") orphanedToolIds.add(id);
        }
      }
    }
  }

  for (const msg of messages) {
    processMessage(msg, items, toolCallIndices, pendingToolCalls, orphanedToolIds, augments);
  }

  const enrichedItems = enrichWriteStdinWithCommand(items);
  const toolGroupedItems = collapseGroupableToolRuns(enrichedItems);
  return collapseSessionSetupRuns(toolGroupedItems);
}

const SESSION_SETUP_PREFIXES = ["# AGENTS.md instructions", "<environment_context>"];

function getPromptText(content: string | ContentBlock[]): string {
  if (typeof content === "string") {
    return content;
  }
  return content
    .filter(
      (block): block is ContentBlock & { type: "text"; text: string } =>
        block.type === "text" && typeof block.text === "string",
    )
    .map((block) => block.text)
    .join("\n");
}

function isSessionSetupPrompt(item: UserPromptItem): boolean {
  const text = getPromptText(item.content).trimStart();
  return SESSION_SETUP_PREFIXES.some((prefix) => text.startsWith(prefix));
}

function collapseSessionSetupRuns(items: RenderItem[]): RenderItem[] {
  const result: RenderItem[] = [];
  let index = 0;

  while (index < items.length) {
    const item = items[index];
    if (!item || item.type !== "user_prompt" || !isSessionSetupPrompt(item)) {
      result.push(item as RenderItem);
      index += 1;
      continue;
    }

    const setupItems: UserPromptItem[] = [];
    let runIndex = index;
    while (runIndex < items.length) {
      const runItem = items[runIndex];
      if (!runItem || runItem.type !== "user_prompt" || !isSessionSetupPrompt(runItem)) {
        break;
      }
      setupItems.push(runItem);
      runIndex += 1;
    }

    // 会话开头或恢复会话时，经常会出现连续的环境/AGENTS.md 提示。
    // 这些属于会话设置噪声，应折叠成一个 session_setup。
    // 但会话中途单独出现的类似文本可能是用户主动发送的内容，所以保留原样。
    if (setupItems.length > 1 || index === 0) {
      const firstSetupItem = setupItems[0];
      if (!firstSetupItem) {
        index = runIndex;
        continue;
      }

      const collapsedItem: SessionSetupItem = {
        type: "session_setup",
        id: `session-setup-${firstSetupItem.id}`,
        title: "Session setup",
        prompts: setupItems.map((setupItem) => setupItem.content),
        sourceMessages: setupItems.flatMap((setupItem) => setupItem.sourceMessages),
      };
      result.push(collapsedItem);
    } else {
      const singleSetupItem = setupItems[0];
      if (singleSetupItem) {
        result.push(singleSetupItem);
      }
    }

    index = runIndex;
  }

  return result;
}

function processMessage(
  msg: Message,
  items: RenderItem[],
  toolCallIndices: Map<string, number>,
  pendingToolCalls: Map<string, number>,
  orphanedToolIds: Set<string>,
  augments?: PreprocessAugments,
): void {
  const msgId = getMessageId(msg);

  // provider 或运行时错误需要显示给用户，因此转成可见的 system item。
  if (msg.type === "error") {
    const errorText =
      (typeof msg.error === "string" && msg.error) ||
      (typeof msg.content === "string" && msg.content) ||
      "Agent error";
    const systemItem: SystemItem = {
      type: "system",
      id: msgId || `error-${msg.timestamp ?? Date.now()}`,
      subtype: "error",
      content: errorText,
      sourceMessages: [msg],
    };
    items.push(systemItem);
    return;
  }

  // 处理 system 消息，例如 compact_boundary、turn_aborted、status 等。
  if (msg.type === "system") {
    const subtype = (msg as { subtype?: string }).subtype ?? "unknown";
    // compact_boundary 和 turn_aborted 对用户有意义，作为系统提示显示在消息流中。
    if (subtype === "compact_boundary" || subtype === "turn_aborted") {
      const systemItem: SystemItem = {
        type: "system",
        id: msgId,
        subtype,
        content:
          typeof msg.content === "string"
            ? msg.content
            : subtype === "turn_aborted"
              ? "Turn aborted"
              : "Context compacted",
        sourceMessages: [msg],
      };
      items.push(systemItem);
    }
    // status 这类系统消息是瞬时状态，页面通过 isCompacting 等状态单独显示。
    // init 等内部消息不进入消息列表，避免暴露底层协议细节。
    return;
  }

  // 调试流式消息切换问题时使用。开启 window.__STREAMING_DEBUG__ 后，
  // 可以看到 assistant 消息的 ID 和 streaming 标记。
  if (typeof window !== "undefined" && window.__STREAMING_DEBUG__ && msg.type === "assistant") {
    console.log("[preprocessMessages] Processing assistant message:", {
      msgId,
      uuid: msg.uuid,
      id: msg.id,
      _isStreaming: msg._isStreaming,
    });
  }

  // 优先读取 SDK 标准结构 message.content；旧数据或部分 provider 可能把 content 放在顶层。
  // 这里保留顶层兜底以兼容历史 JSONL。
  const content =
    (msg.message as { content?: string | ContentBlock[] } | undefined)?.content ?? msg.content;

  // 优先使用 SDK 的 type 判断消息类型；旧数据可能只有 role，所以继续保留 role 兜底。
  const role = (msg.message as { role?: "user" | "assistant" } | undefined)?.role ?? msg.role;
  const isUserMessage = msg.type === "user" || role === "user";
  const isSubagent = (msg as { isSubagent?: unknown }).isSubagent === true;

  // 字符串 content 根据消息角色分流：
  // user 字符串是用户输入；assistant 字符串则转成 text 渲染项。
  if (typeof content === "string") {
    if (isUserMessage) {
      items.push({
        type: "user_prompt",
        id: msgId,
        content,
        sourceMessages: [msg],
        isSubagent,
      });
      return;
    }
    // assistant 字符串内容转成 text item，后续由 TextBlock 渲染。
    if (content.trim()) {
      const messageHtml = (msg as { _html?: string })._html;
      items.push({
        type: "text",
        id: msgId,
        text: content,
        sourceMessages: [msg],
        isSubagent,
        augmentHtml: messageHtml ?? augments?.markdown?.[msgId]?.html,
      });
    }
    return;
  }

  // content 既不是字符串也不是数组时，说明数据形状异常；直接跳过，避免渲染崩溃。
  if (!Array.isArray(content)) {
    return;
  }

  const blockArray = content.filter(
    (block): block is ContentBlock =>
      typeof block !== "string" && block !== null && typeof block === "object",
  );

  // user 消息如果只包含 tool_result，说明它不是用户输入，而是工具结果回传。
  const isToolResultMessage = isUserMessage && blockArray.every((b) => b.type === "tool_result");

  if (isToolResultMessage) {
    // 把 tool_result 挂回之前记录的 pending tool_use 上。
    for (const block of blockArray) {
      if (block.type === "tool_result" && block.tool_use_id) {
        attachToolResult(block, msg, items, pendingToolCalls);
      }
    }
    return;
  }

  // 其它 user 消息都按真实用户输入渲染。
  if (isUserMessage) {
    items.push({
      type: "user_prompt",
      id: msgId,
      content: blockArray,
      sourceMessages: [msg],
      isSubagent,
    });
    return;
  }

  // assistant 数组内容逐块解析。
  // 第一遍先找到最后一个 text block，流式输出光标只放在最后一个文本块上，
  // 避免多段文本同时显示 streaming 状态。
  let lastTextBlockIndex = -1;
  if (msg._isStreaming) {
    for (let i = blockArray.length - 1; i >= 0; i--) {
      const block = blockArray[i];
      // Include empty text blocks when streaming — the last text block is where
      // the waiting cursor should appear even before the first character arrives.
      if (block?.type === "text") {
        lastTextBlockIndex = i;
        break;
      }
    }
  }

  for (let i = 0; i < blockArray.length; i++) {
    const block = blockArray[i];
    if (!block) continue;

    const blockId = `${msgId}-${i}`;

    if (block.type === "text") {
      const isLastStreamingBlock = msg._isStreaming && i === lastTextBlockIndex;
      if (block.text?.trim() || isLastStreamingBlock) {
        // 优先使用服务端直接注入到 block 上的 _html。
        // 如果当前是订阅事件路径，则从 markdownAugments 映射里按 messageId 兜底查找。
        const blockHtml = (block as { _html?: string })._html;
        items.push({
          type: "text",
          id: blockId,
          text: block.text ?? "",
          sourceMessages: [msg],
          isSubagent,
          // 只有最后一个文本块显示流式光标。
          isStreaming: msg._isStreaming && i === lastTextBlockIndex,
          // 优先使用 block 内联 HTML；没有时使用订阅路径缓存的 markdown augment。
          augmentHtml: blockHtml ?? augments?.markdown?.[msgId]?.html,
        });
      }
    } else if (block.type === "thinking") {
      if (block.thinking?.trim()) {
        items.push({
          type: "thinking",
          id: blockId,
          thinking: block.thinking,
          signature: undefined,
          status: "complete",
          sourceMessages: [msg],
          isSubagent,
        });
      }
    } else if (block.type === "tool_use") {
      if (block.id && block.name) {
        // 重连或恢复流时，服务端可能从不同 assistant 快照里 replay 同一个 tool_use id。
        // UI 中每个工具调用只应该出现一次，因此按 tool id 去重并合并 sourceMessages。
        const existingIndex = toolCallIndices.get(block.id);
        if (existingIndex !== undefined) {
          const existingItem = items[existingIndex];
          if (existingItem?.type === "tool_call") {
            items[existingIndex] = appendSourceMessage(existingItem, msg);
            if (existingItem.status === "pending") {
              pendingToolCalls.set(block.id, existingIndex);
            }
          }
          continue;
        }

        // 如果服务端标记该工具调用为 orphaned，说明进程在结果返回前结束，
        // UI 上显示为 aborted/interrupted。
        const isOrphaned = orphanedToolIds.has(block.id);
        const toolCall: ToolCallItem = {
          type: "tool_call",
          id: block.id,
          toolName: block.name,
          toolInput: block.input,
          toolResult: undefined,
          status: isOrphaned ? "aborted" : "pending",
          sourceMessages: [msg],
          isSubagent,
        };
        const itemIndex = items.length;
        toolCallIndices.set(block.id, itemIndex);
        pendingToolCalls.set(block.id, itemIndex);
        items.push(toolCall);
      }
    }
  }
}

function appendSourceMessage(item: ToolCallItem, message: Message): ToolCallItem {
  const messageId = getMessageId(message);
  if (item.sourceMessages.some((source) => getMessageId(source) === messageId)) {
    return item;
  }
  return {
    ...item,
    sourceMessages: [...item.sourceMessages, message],
  };
}

/**
 * 从文本 content block 中解析 Agent/Task 工具结果（SDK 0.2.76+）。
 *
 * 新版 SDK 不再总是提供结构化 tool_use_result，而是把 agentId 和用量统计
 * 写进文本块。例如：
 *   "agentId: abc123 (for resuming...)\n<usage>total_tokens: 1234\ntool_uses: 5\nduration_ms: 6789</usage>"
 *
 * 如果解析成功，返回 TaskRenderer 可识别的 TaskResult 形状；解析失败则返回 undefined。
 */
export function parseAgentResultFromText(block: ContentBlock): Record<string, unknown> | undefined {
  // tool_result 的 content 可能是字符串，也可能是 content block 数组。
  const texts: string[] = [];
  if (typeof block.content === "string") {
    texts.push(block.content);
  } else if (Array.isArray(block.content)) {
    for (const cb of block.content as Array<{ type?: string; text?: string }>) {
      if (cb.type === "text" && cb.text) texts.push(cb.text);
    }
  }

  const fullText = texts.join("\n");
  if (!fullText) return undefined;

  const displayContent = extractAgentDisplayContent(block);

  // agentId 是后续加载子代理 JSONL、关联 Task 行与嵌套内容的关键字段。
  const agentIdMatch = fullText.match(/^agentId:\s*(\S+)/m);
  if (!agentIdMatch) return undefined;

  const result: Record<string, unknown> = {
    agentId: agentIdMatch[1],
    status: "completed",
  };
  if (displayContent && displayContent.length > 0) {
    result.content = displayContent;
  }

  // 从 <usage> 块中提取 token 数、工具调用数和耗时，用于 Task 摘要展示。
  const usageMatch = fullText.match(/<usage>([\s\S]*?)<\/usage>/);
  if (usageMatch?.[1]) {
    const usage = usageMatch[1];
    const tokens = usage.match(/total_tokens:\s*(\d+)/);
    const tools = usage.match(/tool_uses:\s*(\d+)/);
    const duration = usage.match(/duration_ms:\s*(\d+)/);
    if (tokens?.[1]) result.totalTokens = Number(tokens[1]);
    if (tools?.[1]) result.totalToolUseCount = Number(tools[1]);
    if (duration?.[1]) result.totalDurationMs = Number(duration[1]);
  }

  return result;
}

function stripAgentMetadata(text: string): string {
  return text
    .replace(/^agentId:\s*\S+.*$/gm, "")
    .replace(/<usage>[\s\S]*?<\/usage>/g, "")
    .trim();
}

function extractAgentDisplayContent(block: ContentBlock): ContentBlock[] | undefined {
  if (typeof block.content === "string") {
    const text = stripAgentMetadata(block.content);
    return text ? [{ type: "text", text }] : undefined;
  }

  if (!Array.isArray(block.content)) {
    return undefined;
  }

  const displayBlocks: ContentBlock[] = [];
  for (const contentBlock of block.content) {
    if (!contentBlock || typeof contentBlock !== "object") {
      continue;
    }

    if (contentBlock.type === "text" && typeof contentBlock.text === "string") {
      const text = stripAgentMetadata(contentBlock.text);
      if (!text) {
        continue;
      }
      displayBlocks.push({ ...contentBlock, text });
      continue;
    }

    displayBlocks.push(contentBlock as ContentBlock);
  }

  return displayBlocks.length > 0 ? displayBlocks : undefined;
}

function attachToolResult(
  block: ContentBlock,
  resultMessage: Message,
  items: RenderItem[],
  pendingToolCalls: Map<string, number>,
): void {
  const toolUseId = block.tool_use_id;
  if (!toolUseId) return;

  const index = pendingToolCalls.get(toolUseId);
  if (index === undefined) {
    // 找不到对应 tool_use 的孤儿结果。正常情况下不应发生，记录 warning 后跳过。
    console.warn(`Tool result for unknown tool_use: ${toolUseId}`);
    return;
  }

  const item = items[index];
  if (!item || item.type !== "tool_call") return;

  // 把 tool_result 附加到已有 tool_call item 上。
  // SDK/历史数据里结构化结果字段可能是 camelCase，也可能是 snake_case，两种都兼容。
  let structured =
    resultMessage.toolUseResult ?? (resultMessage as Record<string, unknown>).tool_use_result;

  // SDK 0.2.76+ 中 Agent/Task 可能没有结构化 tool_use_result。
  // 这种情况下从文本块中解析 agentId 和用量统计。
  if (!structured && (item.toolName === "Agent" || item.toolName === "Task")) {
    structured = parseAgentResultFromText(block);
  }

  const resultData: ToolResultData = {
    content: typeof block.content === "string" ? block.content : "",
    isError: block.is_error || false,
    structured,
  };

  // 创建新的 ToolCallItem 对象，确保 React 能感知到结果状态更新并重新渲染。
  const updatedItem: ToolCallItem = {
    type: "tool_call",
    id: item.id,
    toolName: item.toolName,
    toolInput: item.toolInput,
    toolResult: resultData,
    status: block.is_error ? "error" : "complete",
    sourceMessages: appendSourceMessage(item, resultMessage).sourceMessages,
    isSubagent: item.isSubagent,
  };

  items[index] = updatedItem;
  pendingToolCalls.delete(toolUseId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isGroupableToolItem(item: RenderItem): item is ToolCallItem {
  if (item.type !== "tool_call") {
    return false;
  }
  if (item.status === "pending") {
    return false;
  }
  if (isToolGroupingDisabled(item.toolName)) {
    return false;
  }
  return true;
}

function dedupeSourceMessages(items: ToolCallItem[]): Message[] {
  const seen = new Set<string>();
  const messages: Message[] = [];

  for (const item of items) {
    for (const message of item.sourceMessages) {
      const id = getMessageId(message);
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      messages.push(message);
    }
  }

  return messages;
}

function buildToolGroup(tools: ToolCallItem[]): ToolGroupItem {
  const first = tools[0];
  const toolName = first ? canonicalizeToolName(first.toolName) : "Unknown";
  return {
    type: "tool_group",
    id: `tool-group-${toolName}-${tools.map((tool) => tool.id).join("-")}`,
    toolName,
    tools,
    sourceMessages: dedupeSourceMessages(tools),
    isSubagent: first?.isSubagent,
  };
}

function collapseGroupableToolRuns(items: RenderItem[]): RenderItem[] {
  const result: RenderItem[] = [];
  let index = 0;

  while (index < items.length) {
    const item = items[index];
    if (!item || !isGroupableToolItem(item)) {
      if (item) {
        result.push(item);
      }
      index += 1;
      continue;
    }

    const canonicalToolName = canonicalizeToolName(item.toolName);
    const tools: ToolCallItem[] = [];
    let runIndex = index;
    while (runIndex < items.length) {
      const runItem = items[runIndex];
      if (!runItem || !isGroupableToolItem(runItem)) {
        break;
      }
      if (canonicalizeToolName(runItem.toolName) !== canonicalToolName) {
        break;
      }
      if (runItem.isSubagent !== item.isSubagent) {
        break;
      }
      tools.push(runItem);
      runIndex += 1;
    }

    result.push(buildToolGroup(tools));
    index = runIndex;
  }

  return result;
}

function extractCommandFromInput(input: unknown): string | undefined {
  if (!isRecord(input)) {
    return undefined;
  }
  if (typeof input.command === "string" && input.command.trim().length > 0) {
    return input.command;
  }
  if (typeof input.cmd === "string" && input.cmd.trim().length > 0) {
    return input.cmd;
  }
  return undefined;
}

function coerceSessionId(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return undefined;
}

function extractSessionIdFromWriteStdinInput(input: unknown): string | undefined {
  if (!isRecord(input)) {
    return undefined;
  }
  return coerceSessionId(input.session_id ?? input.sessionId);
}

function extractSessionIdFromToolResult(item: ToolCallItem): string | undefined {
  const structured = item.toolResult?.structured;
  if (isRecord(structured)) {
    const fromStructured = coerceSessionId(structured.session_id ?? structured.sessionId);
    if (fromStructured) {
      return fromStructured;
    }
  }

  const raw = item.toolResult?.content ?? "";
  const text = typeof raw === "string" ? raw : "";
  const match = text.match(
    /(?:^|\n)\s*(?:Process\s+running\s+with\s+session\s+ID|session(?:\s+id)?)\s*:?\s*(\d+)\b/i,
  );
  if (!match?.[1]) {
    return undefined;
  }
  return match[1];
}

function withLinkedCommand(input: unknown, command: string): unknown {
  if (!isRecord(input)) {
    return input;
  }
  if (typeof input.linked_command === "string" && input.linked_command.trim()) {
    return input;
  }
  return { ...input, linked_command: command };
}

function withLinkedFilePath(input: unknown, filePath: string): unknown {
  if (!isRecord(input)) {
    return input;
  }
  if (typeof input.linked_file_path === "string" && input.linked_file_path.trim()) {
    return input;
  }
  return { ...input, linked_file_path: filePath };
}

function withLinkedToolName(input: unknown, toolName: string): unknown {
  if (!isRecord(input)) {
    return input;
  }
  if (typeof input.linked_tool_name === "string" && input.linked_tool_name.trim()) {
    return input;
  }
  return { ...input, linked_tool_name: toolName };
}

function isCommandSessionToolName(toolName: string): boolean {
  const normalized = toolName.toLowerCase();
  return normalized === "bash" || normalized === "exec_command" || normalized === "shell_command";
}

function isFileSessionToolName(toolName: string): boolean {
  const normalized = toolName.toLowerCase();
  return normalized === "read" || normalized === "write" || normalized === "edit";
}

function extractFilePathFromToolInput(input: unknown): string | undefined {
  if (!isRecord(input) || typeof input.file_path !== "string") {
    return undefined;
  }
  const filePath = input.file_path.trim();
  return filePath.length > 0 ? filePath : undefined;
}

function enrichWriteStdinWithCommand(items: RenderItem[]): RenderItem[] {
  const sessionToMetadata = new Map<
    string,
    { command?: string; filePath?: string; toolName?: string }
  >();

  return items.map((item) => {
    if (item.type !== "tool_call") {
      return item;
    }

    if (isCommandSessionToolName(item.toolName) || isFileSessionToolName(item.toolName)) {
      const sessionId = extractSessionIdFromToolResult(item);
      if (!sessionId) {
        return item;
      }

      const existing = sessionToMetadata.get(sessionId) ?? {};
      const command = isCommandSessionToolName(item.toolName)
        ? extractCommandFromInput(item.toolInput)
        : undefined;
      const filePath = isFileSessionToolName(item.toolName)
        ? extractFilePathFromToolInput(item.toolInput)
        : undefined;

      sessionToMetadata.set(sessionId, {
        command: command ?? existing.command,
        filePath: filePath ?? existing.filePath,
        toolName: item.toolName ?? existing.toolName,
      });
      return item;
    }

    const toolName = item.toolName.toLowerCase();
    if (toolName !== "writestdin" && toolName !== "write_stdin") {
      return item;
    }

    const sessionId = extractSessionIdFromWriteStdinInput(item.toolInput);
    if (!sessionId) {
      return item;
    }

    const metadata = sessionToMetadata.get(sessionId);
    if (!metadata) {
      return item;
    }

    let toolInput = item.toolInput;
    if (metadata.command) {
      toolInput = withLinkedCommand(toolInput, metadata.command);
    }
    if (metadata.filePath) {
      toolInput = withLinkedFilePath(toolInput, metadata.filePath);
    }
    if (metadata.toolName) {
      toolInput = withLinkedToolName(toolInput, metadata.toolName);
    }

    if (toolInput === item.toolInput) {
      return item;
    }

    return {
      ...item,
      toolInput,
    };
  });
}
