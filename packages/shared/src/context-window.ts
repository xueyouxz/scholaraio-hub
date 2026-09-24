import type { ProviderName } from "./types.js";

/** Default context window size (200K tokens) */
export const DEFAULT_CONTEXT_WINDOW = 200_000;
/** Default context window size for Codex cloud sessions when metadata is missing */
export const CODEX_DEFAULT_CONTEXT_WINDOW = 258_000;
export const CLAUDE_EXTENDED_CONTEXT_WINDOW = 1_000_000;

/**
 * Known context window sizes for different models.
 *
 * Claude models:
 * - Opus / Sonnet / Haiku standard aliases: 200K
 * - Explicit "[1m]" Claude variants: 1M
 * - Sonnet 3.5: 200K
 *
 * Gemini models:
 * - Gemini 2.0/1.5: 1M
 *
 * GPT models:
 * - GPT-4: 128K (varies by variant)
 * - GPT-4o: 128K
 * - GPT-5 / Codex 5.x: ~258K
 */
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  // Claude models - 200K context
  opus: 200_000,
  sonnet: 200_000,
  haiku: 200_000,
  // Gemini models - 1M context
  gemini: 1_000_000,
  // GPT-5 / Codex models - ~258K context
  "gpt-5": CODEX_DEFAULT_CONTEXT_WINDOW,
  codex: CODEX_DEFAULT_CONTEXT_WINDOW,
  // GPT-4 models - 128K context
  "gpt-4": 128_000,
  "gpt-4o": 128_000,
  "gpt-4-turbo": 128_000,
};

/**
 * Get the context window size for a given model.
 *
 * Parses model IDs like:
 * - "claude-opus-4-5-20251101" → opus → 200K
 * - "claude-opus-4-6[1m]" → opus → 1M
 * - "claude-sonnet-4-20250514" → sonnet → 200K
 * - "sonnet[1m]" → sonnet → 1M
 * - "claude-3-5-sonnet-20241022" → sonnet → 200K
 * - "gemini-2.0-flash-exp" → gemini → 1M
 * - "gpt-4o-2024-08-06" → gpt-4o → 128K
 *
 * @param model - Model ID string (e.g., "claude-opus-4-5-20251101")
 * @param provider - Provider name for fallback defaults when model is missing
 * @returns Context window size in tokens
 */
export function getModelContextWindow(model: string | undefined, provider?: ProviderName): number {
  if (!model) {
    return provider === "codex" ? CODEX_DEFAULT_CONTEXT_WINDOW : DEFAULT_CONTEXT_WINDOW;
  }

  const lowerModel = model.toLowerCase();

  if (lowerModel.includes("[1m]")) {
    return CLAUDE_EXTENDED_CONTEXT_WINDOW;
  }

  // Handle model IDs that may include provider namespace or other prefixes.
  if (lowerModel.includes("gpt-5") || lowerModel.includes("codex")) {
    return CODEX_DEFAULT_CONTEXT_WINDOW;
  }

  // Check for exact prefix matches first (for GPT models)
  for (const [prefix, size] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
    if (lowerModel.startsWith(prefix)) {
      return size;
    }
  }

  // Parse Claude model IDs: claude-{family}-{version} or claude-{version}-{family}
  // Examples: claude-opus-4-5-*, claude-sonnet-4-*, claude-3-5-sonnet-*
  const claudeMatch = lowerModel.match(/claude-(?:(\w+)-\d|(\d+-\d+-)?(\w+))/);
  if (claudeMatch) {
    const family = claudeMatch[1] || claudeMatch[3];
    if (family && MODEL_CONTEXT_WINDOWS[family]) {
      return MODEL_CONTEXT_WINDOWS[family];
    }
  }

  // Check for Gemini models
  if (lowerModel.includes("gemini")) {
    return MODEL_CONTEXT_WINDOWS.gemini ?? DEFAULT_CONTEXT_WINDOW;
  }

  // Provider-level fallback when we don't recognize the model string.
  if (provider === "codex") {
    return CODEX_DEFAULT_CONTEXT_WINDOW;
  }

  return DEFAULT_CONTEXT_WINDOW;
}
