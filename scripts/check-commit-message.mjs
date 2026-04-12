import { readFileSync } from "node:fs";

const messageFile = process.argv[2];

if (!messageFile) {
  process.exit(0);
}

const rawMessage = readFileSync(messageFile, "utf-8");
const message = rawMessage
  .split("\n")
  .filter((line) => !line.trim().startsWith("#"))
  .join("\n")
  .trim();

const bannedPattern = /\b(ai|gpt|chatgpt|openai|claude|codex|llm)\b|人工智能|智能助手/i;

if (bannedPattern.test(message)) {
  console.error(
    "Commit message validation failed: avoid AI-related wording in the commit message.",
  );
  process.exit(1);
}
