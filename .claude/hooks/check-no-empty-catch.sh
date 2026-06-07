#!/usr/bin/env bash
# PostToolUse (Edit|Write|MultiEdit): reject silent empty .catch(() => {}) swallows.
# Enforces .claude/rules/server.md error-handling rule. May have false positives.
set -euo pipefail

input=$(cat)
file_path=$(printf '%s' "$input" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);process.stdout.write((j.tool_input&&j.tool_input.file_path)||"")}catch{}})')

[[ -z "$file_path" ]] && exit 0
case "$file_path" in
  *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs) ;;
  *) exit 0 ;;
esac
[[ -f "$file_path" ]] || exit 0

# .catch( (..) => {} ) with an empty body
matches=$(grep -nE '\.catch\([[:space:]]*\([^)]*\)[[:space:]]*=>[[:space:]]*\{[[:space:]]*\}' "$file_path" || true)
if [[ -n "$matches" ]]; then
  echo "Silent empty .catch(() => {}) is prohibited — log the error with enough context to diagnose it (.claude/rules/server.md). Found in $file_path:" >&2
  printf '%s\n' "$matches" >&2
  exit 2
fi
exit 0
