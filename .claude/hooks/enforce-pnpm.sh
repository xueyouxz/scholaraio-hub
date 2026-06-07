#!/usr/bin/env bash
# PreToolUse (Bash): block mutating npm/yarn commands; this repo pins pnpm@10.
# Read-only npm view/info/ls and npx are allowed.
set -euo pipefail

input=$(cat)
cmd=$(printf '%s' "$input" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);process.stdout.write((j.tool_input&&j.tool_input.command)||"")}catch{}})')

# npm with a mutating subcommand
if printf '%s' "$cmd" | grep -Eq '(^|[;&|[:space:]])npm[[:space:]]+(install|i|ci|add|uninstall|remove|rm|update|up)([[:space:]]|$)'; then
  echo "Blocked: use pnpm, not npm. This repo pins pnpm@10 (package.json packageManager + engines). Use the equivalent pnpm command (e.g. 'pnpm add', 'pnpm install')." >&2
  exit 2
fi

# yarn (bare = install) or yarn with a mutating subcommand
if printf '%s' "$cmd" | grep -Eq '(^|[;&|[:space:]])yarn([[:space:]]+(add|install|remove|up|upgrade|global)([[:space:]]|$)|[[:space:]]*$)'; then
  echo "Blocked: use pnpm, not yarn. This repo pins pnpm@10. Use the equivalent pnpm command." >&2
  exit 2
fi
exit 0
