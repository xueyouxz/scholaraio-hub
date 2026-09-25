#!/usr/bin/env bash
# PostToolUse (Edit|Write|MultiEdit): run the repository convention check on the
# edited file, so an agent hears about it at edit time. The same script runs in
# lint-staged and `pnpm lint` for everyone else (scripts/check-conventions.mjs).
set -euo pipefail

input=$(cat)
file_path=$(printf '%s' "$input" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);process.stdout.write((j.tool_input&&j.tool_input.file_path)||"")}catch{}})')

[[ -z "$file_path" ]] && exit 0
cd "${CLAUDE_PROJECT_DIR:-.}"
node scripts/check-conventions.mjs "$file_path" || exit 2
