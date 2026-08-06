#!/usr/bin/env bash
# PreToolUse hook on Write|Edit: blocks modifications to the locked-contract
# files. Locked files require an ADR + major-version plan per CLAUDE.md.
#
# Stdin: {"tool_input": {"file_path": "..."}}
# Stdout: JSON {"decision":"block", "reason":"..."} on block; nothing on allow.

set -euo pipefail

FP="$(jq -r '.tool_input.file_path // empty' 2>/dev/null || true)"
[ -z "$FP" ] && exit 0

# Strip absolute prefix; compare basename + suffix to handle both abs and rel paths.
case "$FP" in
  */src/contracts.ts|src/contracts.ts) LOCKED="src/contracts.ts" ;;
  *) exit 0 ;;
esac

REASON="$LOCKED is a locked contract. Modifying it requires an ADR (dev-docs/decisions/_template.md), a major version bump, and a migration plan. See CLAUDE.md and ARCHITECTURE.md. If you're sure this is the right path, take it out of the Claude session and apply the edit yourself with the full ADR in hand."

jq -n --arg reason "$REASON" \
  '{decision:"block", reason:$reason, hookSpecificOutput:{hookEventName:"PreToolUse", permissionDecision:"deny", permissionDecisionReason:$reason}}'

exit 0
