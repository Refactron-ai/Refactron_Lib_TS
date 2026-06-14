#!/usr/bin/env bash
# PreToolUse hook on Bash: blocks dangerous commands that the project rules
# (CLAUDE.md, COMMIT_CONVENTIONS.md, RUNBOOK.md) say should never be silently
# auto-run. Replaces the broken `Bash(... *--no-verify*)` deny glob — internal
# wildcards aren't supported by the permission matcher, so a real exec hook is
# the correct enforcement.
#
# Stdin: {"tool_input": {"command": "..."}}
# Stdout: JSON {"decision": "block", "reason": "..."} on block; nothing on allow.

set -euo pipefail

CMD="$(jq -r '.tool_input.command // empty' 2>/dev/null || true)"
[ -z "$CMD" ] && exit 0

block() {
  jq -n --arg reason "$1" \
    '{decision:"block", reason:$reason, hookSpecificOutput:{hookEventName:"PreToolUse", permissionDecision:"deny", permissionDecisionReason:$reason}}'
  exit 0
}

# BSD grep on macOS doesn't support `\b`. Match against literal substrings
# and use [[:space:]] for word boundaries where needed.

# --no-verify on commit or push: bypasses hooks. Always blocked.
if echo "$CMD" | grep -qE 'git[[:space:]]+(commit|push)' \
   && echo "$CMD" | grep -qE -- '--no-verify'; then
  block "git --no-verify bypasses the commit-msg hook. Fix the underlying issue (see COMMIT_CONVENTIONS.md) instead of bypassing it."
fi

# Force-push: history rewrite, usually a mistake.
if echo "$CMD" | grep -qE 'git[[:space:]]+push' \
   && echo "$CMD" | grep -qE -- '(--force([[:space:]]|$)|--force-with-lease|[[:space:]]-f([[:space:]]|$))'; then
  block "git push --force is a CR-block (see CLAUDE.md). Open a regular PR; if you genuinely need force-push, run it yourself."
fi

# Hard reset: destroys uncommitted work.
if echo "$CMD" | grep -qE 'git[[:space:]]+reset' \
   && echo "$CMD" | grep -qE -- '--hard'; then
  block "git reset --hard is destructive. Verify intent and run it yourself."
fi

# npm publish: never automated. Allow --dry-run.
if echo "$CMD" | grep -qE 'npm[[:space:]]+publish' \
   && ! echo "$CMD" | grep -qE -- '--dry-run'; then
  block "npm publish is restricted to the release runbook. Run it yourself after the dry-run passes (see RUNBOOK.md)."
fi

# rm -rf on broad targets.
if echo "$CMD" | grep -qE 'rm[[:space:]]+-[rRf]+' \
   && echo "$CMD" | grep -qE '([[:space:]]/|[[:space:]]\./|/\*)'; then
  block "rm -rf on a broad target is destructive. Narrow the target or run it yourself."
fi

exit 0
