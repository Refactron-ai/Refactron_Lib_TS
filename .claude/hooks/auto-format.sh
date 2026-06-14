#!/usr/bin/env bash
# PostToolUse hook on Write|Edit: auto-formats supported file types with
# prettier so the format:check gate doesn't fail in CI on small style nits.
# Silent on success; silent on failure (formatter errors don't block the
# session — code reviewer + format:check catch them).
#
# Stdin: {"tool_response": {"filePath": "..."}, "tool_input": {"file_path": "..."}}

set -euo pipefail

FP="$(jq -r '.tool_response.filePath // .tool_input.file_path // empty' 2>/dev/null || true)"
[ -z "$FP" ] && exit 0
[ ! -f "$FP" ] && exit 0

case "$FP" in
  *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.json|*.md|*.mdx|*.yml|*.yaml)
    # --log-level error: silent unless something is genuinely wrong.
    # --ignore-unknown: prettier skips files outside its known list (Python, etc.).
    npx --no-install prettier --write --log-level=error --ignore-unknown "$FP" 2>/dev/null || true
    ;;
esac

exit 0
