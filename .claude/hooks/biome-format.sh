#!/usr/bin/env bash
# PostToolUse (Edit|Write|MultiEdit): auto-format the edited file with Biome.
# Enforces CLAUDE.md formatting (2-space, double quotes, semicolons, 100 cols) at edit time.
# Never blocks — formatting only; linting stays with husky/CI.
set -euo pipefail

input=$(cat)
file_path=$(printf '%s' "$input" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);process.stdout.write((j.tool_input&&j.tool_input.file_path)||"")}catch{}})')

[[ -z "$file_path" ]] && exit 0
case "$file_path" in
  *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.json|*.jsonc|*.css) ;;
  *) exit 0 ;;
esac
[[ -f "$file_path" ]] || exit 0

cd "${CLAUDE_PROJECT_DIR:-.}"
pnpm exec biome check --write --no-errors-on-unmatched "$file_path" >/dev/null 2>&1 || true
exit 0
