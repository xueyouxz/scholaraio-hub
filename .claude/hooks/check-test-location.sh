#!/usr/bin/env bash
# PostToolUse (Edit|Write|MultiEdit): enforce test file location convention.
# client tests -> sibling __tests__/ ; server & shared tests -> test/ directory.
set -euo pipefail

input=$(cat)
file_path=$(printf '%s' "$input" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);process.stdout.write((j.tool_input&&j.tool_input.file_path)||"")}catch{}})')

[[ -z "$file_path" ]] && exit 0
case "$file_path" in
  *.test.ts|*.test.tsx) ;;
  *) exit 0 ;;
esac

case "$file_path" in
  */packages/client/*)
    if [[ "$file_path" != */__tests__/* ]]; then
      echo "Client tests must live in a sibling __tests__/ directory (e.g. src/core/__tests__/api.test.ts). $file_path is not under __tests__/ (CLAUDE.md Testing)." >&2
      exit 2
    fi ;;
  */packages/server/*|*/packages/shared/*)
    if [[ "$file_path" != */test/* ]]; then
      echo "server/shared tests must live under a test/ directory (e.g. packages/server/test/...). $file_path is not under test/ (CLAUDE.md Testing)." >&2
      exit 2
    fi ;;
esac
exit 0
