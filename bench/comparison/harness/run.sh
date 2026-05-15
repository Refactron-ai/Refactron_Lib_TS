#!/usr/bin/env bash
# run.sh -- comparison benchmark harness.
#
# Methodology:
#   For each (tool, transform) cell:
#     1 warm-up run (discarded) + N measured runs (default 5).
#   Each run:
#     - copy the fixture dir to a fresh mktemp -d (cold start; no warm caches)
#     - run the tool's invocation, timed via /usr/bin/time -p
#     - run the coverage checker against the modified fixture
#     - run the safety suite (compile + tests)
#     - append a single JSON line to results-<DATE>.jsonl.
#
# Override: TOOLS=refactron,eslint TRANSFORMS=var-to-const-let ITERATIONS=2 ./run.sh

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
COMP_DIR="$ROOT/bench/comparison"

ITERATIONS="${ITERATIONS:-5}"
DATE="$(date +%Y-%m-%d)"
RESULTS="$COMP_DIR/results-${DATE}.jsonl"

# Pre-built tool binaries.
JSCS_BIN="$COMP_DIR/codemods/jscodeshift/node_modules/.bin/jscodeshift"
ESLINT_BIN="$COMP_DIR/codemods/eslint/node_modules/.bin/eslint"
ESLINT_CONFIG="$COMP_DIR/codemods/eslint/eslint.config.mjs"
COMBY_BIN="$(command -v comby || echo 'comby-not-found')"
JSCS_TRANSFORM="$COMP_DIR/codemods/jscodeshift/var-to-const-let.js"
COMBY_VAR_CONFIG="$COMP_DIR/codemods/comby/var-to-const-let.toml"
COMBY_FMT_CONFIG="$COMP_DIR/codemods/comby/format-to-fstring.toml"
LIBCST_RUNNER="$COMP_DIR/codemods/libcst/format-to-fstring.py"
REFACTRON_BIN="$ROOT/dist/cli/index.js"
CHECKER_TS="$COMP_DIR/harness/checker.ts"
CHECKER_PY="$COMP_DIR/harness/checker.py"
SAFETY="$COMP_DIR/harness/safety.sh"

DEFAULT_TOOLS="refactron,jscodeshift,comby,eslint,libcst"
DEFAULT_TRANSFORMS="var-to-const-let,format-to-fstring"
DEFAULT_SIZES="small"
TOOLS_LIST="${TOOLS:-$DEFAULT_TOOLS}"
TRANSFORMS_LIST="${TRANSFORMS:-$DEFAULT_TRANSFORMS}"
SIZES_LIST="${SIZES:-$DEFAULT_SIZES}"

# Tool/transform applicability matrix.
applicable() {
  local tool="$1" transform="$2"
  case "$tool:$transform" in
    refactron:*) return 0 ;;
    jscodeshift:var-to-const-let) return 0 ;;
    eslint:var-to-const-let) return 0 ;;
    comby:*) return 0 ;;
    libcst:format-to-fstring) return 0 ;;
    *) return 1 ;;
  esac
}

# --- Per-tool invocations (operate in-place on a working dir).

invoke() {
  local tool="$1" transform="$2" workdir="$3"
  case "$tool:$transform" in
    refactron:var-to-const-let)
      REFACTRON_TOKEN=dummy node "$REFACTRON_BIN" run --apply --transforms=var_to_const_let "$workdir" >/dev/null 2>&1
      ;;
    refactron:format-to-fstring)
      REFACTRON_TOKEN=dummy node "$REFACTRON_BIN" run --apply --transforms=format_to_fstring "$workdir" >/dev/null 2>&1
      ;;
    jscodeshift:var-to-const-let)
      ( cd "$workdir" && "$JSCS_BIN" -t "$JSCS_TRANSFORM" --extensions=ts --parser=ts --no-babel \
        f01.ts f02.ts f03.ts f04.ts f05.ts f06.ts f07.ts f08.ts f09.ts f10.ts ) >/dev/null 2>&1
      ;;
    eslint:var-to-const-let)
      # ESLint v10 enforces a config "base path"; running from inside the
      # fixture dir keeps every target file in scope.
      ( cd "$workdir" && "$ESLINT_BIN" -c "$ESLINT_CONFIG" --fix \
        f01.ts f02.ts f03.ts f04.ts f05.ts f06.ts f07.ts f08.ts f09.ts f10.ts ) >/dev/null 2>&1
      ;;
    comby:var-to-const-let)
      # Comby's TOML config loader insists on positional args even with
      # -config; we use the inline template form (functionally identical to
      # codemods/comby/var-to-const-let.toml -- the toml is kept as
      # documentation of the rule).
      ( cd "$workdir" && "$COMBY_BIN" 'var :[name] :[rest]' 'let :[name] :[rest]' .ts -in-place -directory . -depth 1 ) >/dev/null 2>&1
      ;;
    comby:format-to-fstring)
      # Two passes: simple .format(NAME) and simple "...%s..." % NAME.
      ( cd "$workdir" && "$COMBY_BIN" '":[before]{}:[after]".format(:[arg])' 'f":[before]{:[arg]}:[after]"' .py -in-place -directory . -depth 1 ) >/dev/null 2>&1
      ( cd "$workdir" && "$COMBY_BIN" '":[before]%s:[after]" % :[arg]' 'f":[before]{:[arg]}:[after]"' .py -in-place -directory . -depth 1 ) >/dev/null 2>&1
      ;;
    libcst:format-to-fstring)
      python3 "$LIBCST_RUNNER" "$workdir" >/dev/null 2>&1
      ;;
    *)
      return 99
      ;;
  esac
}

prepare_workdir() {
  local transform="$1" size="$2"
  local src="$COMP_DIR/fixtures/$transform/$size"
  local dst
  dst="$(mktemp -d -t comparison-XXXXXX)"
  # Copy everything except node_modules / __pycache__ / etc. We use cp -R then
  # remove heavy dirs.
  cp -R "$src/." "$dst/"
  rm -rf "$dst/node_modules" "$dst/__pycache__" "$dst/.pytest_cache" 2>/dev/null
  # For TS transform: link node_modules from the source (we don't want the
  # tool to time-include npm install, but we need vitest/tsc available for
  # safety checks). Symlink is much faster than cp.
  if [ "$transform" = "var-to-const-let" ] && [ -d "$src/node_modules" ]; then
    ln -s "$src/node_modules" "$dst/node_modules"
  fi
  echo "$dst"
}

run_checker() {
  local transform="$1" workdir="$2"
  local expected="$COMP_DIR/fixtures/$transform/small"
  case "$transform" in
    var-to-const-let)
      ( cd "$ROOT" && npx --no-install tsx "$CHECKER_TS" --fixture "$workdir" --expected "$expected" 2>/dev/null )
      ;;
    format-to-fstring)
      python3 "$CHECKER_PY" --fixture "$workdir" --expected "$expected" 2>/dev/null
      ;;
  esac
}

run_safety() {
  local transform="$1" workdir="$2"
  bash "$SAFETY" "$transform" "$workdir"
}

emit_record() {
  python3 - "$@" <<'PY'
import json, sys
keys = ["transform","tool","fixture_size","run","wall_clock_seconds","exit_code","coverage_json","safety_json","notes"]
vals = sys.argv[1:]
d = dict(zip(keys, vals))
record = {
  "transform": d["transform"],
  "tool": d["tool"],
  "fixture_size": d["fixture_size"],
  "run": int(d["run"]),
  "wall_clock_seconds": float(d["wall_clock_seconds"]),
  "exit_code": int(d["exit_code"]),
  "coverage": json.loads(d["coverage_json"]) if d["coverage_json"] else None,
  "safety": json.loads(d["safety_json"]) if d["safety_json"] else None,
  "notes": d["notes"],
}
print(json.dumps(record))
PY
}

emit_na() {
  python3 - "$@" <<'PY'
import json, sys
record = {
  "transform": sys.argv[1],
  "tool": sys.argv[2],
  "fixture_size": sys.argv[3],
  "run": None,
  "wall_clock_seconds": None,
  "exit_code": None,
  "coverage": None,
  "safety": None,
  "tool_applicable": False,
  "notes": sys.argv[4],
}
print(json.dumps(record))
PY
}

# --- Setup output file.
mkdir -p "$COMP_DIR"
{
  echo "# Refactron comparison bench raw results -- $DATE"
  echo "# Hardware: $(sysctl -n machdep.cpu.brand_string 2>/dev/null || uname -m)"
  echo "# Memory:   $(($(sysctl -n hw.memsize 2>/dev/null || echo 0)/1024/1024/1024))GB"
  echo "# Node:     $(node --version)   Python: $(python3 --version | awk '{print $2}')"
  echo "# Iterations per cell: $ITERATIONS (+1 warmup discarded)"
  echo "# One JSON record per measured run below."
} > "$RESULTS"

IFS=',' read -ra TOOLS_ARR <<< "$TOOLS_LIST"
IFS=',' read -ra TRANSFORMS_ARR <<< "$TRANSFORMS_LIST"
IFS=',' read -ra SIZES_ARR <<< "$SIZES_LIST"

for transform in "${TRANSFORMS_ARR[@]}"; do
  for size in "${SIZES_ARR[@]}"; do
    for tool in "${TOOLS_ARR[@]}"; do
      if ! applicable "$tool" "$transform"; then
        echo "==> $tool / $transform / $size: N/A (tool does not apply)"
        emit_na "$transform" "$tool" "$size" "tool not applicable to this transform" >> "$RESULTS"
        continue
      fi
      echo "==> $tool / $transform / $size: warmup..."
      WORK="$(prepare_workdir "$transform" "$size")"
      invoke "$tool" "$transform" "$WORK" || true
      rm -rf "$WORK"

      for run in $(seq 1 "$ITERATIONS"); do
        WORK="$(prepare_workdir "$transform" "$size")"
        # Time the tool invocation only (Python time gives sub-second precision).
        START=$(python3 -c 'import time;print(time.time())')
        invoke "$tool" "$transform" "$WORK"
        EXIT=$?
        END=$(python3 -c 'import time;print(time.time())')
        ELAPSED=$(python3 -c "print(round(${END} - ${START}, 3))")

        # Coverage.
        COV=$(run_checker "$transform" "$WORK")
        if [ -z "$COV" ]; then COV='{"correct":0,"missed":0,"wrong":0,"broken_syntax":0,"total_planted":0}'; fi

        # Safety. For TS transform, ensure node_modules link exists in WORK
        # (prepare_workdir already does this).
        SAF=$(run_safety "$transform" "$WORK")
        if [ -z "$SAF" ]; then SAF='{"compiles":false,"tests_pass":false,"failing_tests":["safety-error"]}'; fi

        echo "    run $run: ${ELAPSED}s exit=$EXIT coverage=$COV"
        emit_record "$transform" "$tool" "$size" "$run" "$ELAPSED" "$EXIT" "$COV" "$SAF" "" >> "$RESULTS"

        rm -rf "$WORK"
      done
    done
  done
done

echo
echo "==> Done. Results: $RESULTS"
