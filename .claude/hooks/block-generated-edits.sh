#!/usr/bin/env bash
# PreToolUse (Edit|Write|MultiEdit): block hand-edits to generated code.
# Enforces .claude/rules/server.md "Codex Protocol / Version Audit Gate".
set -euo pipefail

input=$(cat)
file_path=$(printf '%s' "$input" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);process.stdout.write((j.tool_input&&j.tool_input.file_path)||"")}catch{}})')

if [[ "$file_path" == *"/packages/server/src/providers/codex/protocol/generated/"* ]]; then
  echo "Blocked: packages/server/src/providers/codex/protocol/generated/ is generated output and must not be hand-edited. Regenerate it, then audit the Codex provider code and its tests in the same change (see .claude/rules/server.md)." >&2
  exit 2
fi
if [[ "$file_path" == *"/packages/shared/src/generated/"* ]]; then
  echo "Blocked: packages/shared/src/generated/ is generated from the library service's OpenAPI document. Change packages/scholaraio/scholaraio/interfaces/api/responses.py (or the routes), then run pnpm gen:library-types." >&2
  exit 2
fi
exit 0
