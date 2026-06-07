#!/usr/bin/env bash
# PostToolUse (Edit|Write|MultiEdit): reject type/lint suppression comments.
# Enforces CLAUDE.md "No bypass comments".
set -euo pipefail

input=$(cat)
file_path=$(printf '%s' "$input" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);process.stdout.write((j.tool_input&&j.tool_input.file_path)||"")}catch{}})')

[[ -z "$file_path" ]] && exit 0
case "$file_path" in
  *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs) ;;
  *) exit 0 ;;
esac
[[ -f "$file_path" ]] || exit 0

matches=$(grep -nE '@ts-ignore|@ts-nocheck|biome-ignore|eslint-disable' "$file_path" || true)
if [[ -n "$matches" ]]; then
  echo "Suppression comments are not allowed — fix the underlying type/lint error instead (CLAUDE.md). Found in $file_path:" >&2
  printf '%s\n' "$matches" >&2
  exit 2
fi
exit 0
