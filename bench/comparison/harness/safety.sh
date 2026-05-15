#!/usr/bin/env bash
# safety.sh -- run the per-language safety checks on a (modified) fixture dir.
#
# Usage:
#   safety.sh <transform> <fixture-dir>
#
# Outputs (stdout) a single JSON line:
#   {"compiles": true|false, "tests_pass": true|false, "failing_tests": [...], "compile_log": "<path>", "test_log": "<path>"}
#
# Returns exit 0 even on test failures -- the JSON line is the data.

set -uo pipefail
TRANSFORM="${1:-}"
FIXTURE_DIR="${2:-}"
[ -z "$TRANSFORM" ] && { echo '{"compiles":false,"tests_pass":false,"failing_tests":["bad-args"]}'; exit 0; }
[ -z "$FIXTURE_DIR" ] && { echo '{"compiles":false,"tests_pass":false,"failing_tests":["bad-args"]}'; exit 0; }

LOG_DIR="$(mktemp -d)"
COMPILE_LOG="$LOG_DIR/compile.log"
TEST_LOG="$LOG_DIR/test.log"
COMPILES=true
TESTS_PASS=true
FAILING="[]"

case "$TRANSFORM" in
  var-to-const-let)
    # tsc --noEmit then vitest.
    if ! ( cd "$FIXTURE_DIR" && npx --no-install tsc --noEmit ) > "$COMPILE_LOG" 2>&1; then
      COMPILES=false
    fi
    if [ "$COMPILES" = "true" ]; then
      if ! ( cd "$FIXTURE_DIR" && npx --no-install vitest run --reporter=default ) > "$TEST_LOG" 2>&1; then
        TESTS_PASS=false
        # Best-effort failing test names from vitest's output.
        FAILING=$(grep -E '^ FAIL ' "$TEST_LOG" | head -20 | sed 's/"/\\"/g' | awk 'BEGIN{printf "["} {if(NR>1)printf ","; printf "\"%s\"",$0} END{printf "]"}')
        [ -z "$FAILING" ] && FAILING='["unknown-failure"]'
      fi
    else
      TESTS_PASS=false
      FAILING='["did-not-compile"]'
    fi
    ;;
  format-to-fstring)
    # py_compile every fixture .py then pytest.
    if ! ( cd "$FIXTURE_DIR" && python3 -m py_compile $(ls f*.py 2>/dev/null) ) > "$COMPILE_LOG" 2>&1; then
      COMPILES=false
    fi
    if [ "$COMPILES" = "true" ]; then
      if ! ( cd "$FIXTURE_DIR" && python3 -m pytest -q --no-header ) > "$TEST_LOG" 2>&1; then
        TESTS_PASS=false
        FAILING=$(grep -E '^FAILED ' "$TEST_LOG" | head -20 | sed 's/"/\\"/g' | awk 'BEGIN{printf "["} {if(NR>1)printf ","; printf "\"%s\"",$0} END{printf "]"}')
        [ -z "$FAILING" ] && FAILING='["unknown-failure"]'
      fi
    else
      TESTS_PASS=false
      FAILING='["did-not-compile"]'
    fi
    ;;
  *)
    echo "{\"compiles\":false,\"tests_pass\":false,\"failing_tests\":[\"unknown-transform:$TRANSFORM\"]}"
    exit 0
    ;;
esac

printf '{"compiles":%s,"tests_pass":%s,"failing_tests":%s,"compile_log":"%s","test_log":"%s"}\n' \
  "$COMPILES" "$TESTS_PASS" "$FAILING" "$COMPILE_LOG" "$TEST_LOG"
