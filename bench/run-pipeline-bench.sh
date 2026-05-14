#!/usr/bin/env bash
# bench/run-pipeline-bench.sh
# Full-pipeline bench on the python-legacy-mini fixture.
# Measures analyze + run --dry-run + run --apply (with the 3-gate
# verifier including the real pytest suite running on a shadow tree).
#
# Why python-legacy-mini and not a synthetic fixture: the apply step's
# test gate executes the project's test suite on a shadow tree. The
# synthetic generator produces files but no tests, so the test gate is
# a no-op there. python-legacy-mini ships with a real pytest suite that
# exercises every transformed function, which is what we need to time.

set -euo pipefail
cd "$(dirname "$0")/.."

ITERATIONS="${ITERATIONS:-5}"
DATE="$(date +%Y-%m-%d)"
OUT="bench/pipeline-results-${DATE}.txt"

echo "==> Building dist/ (if stale)..."
npm run build > /dev/null 2>&1

# Confirm pytest + libcst are installed for the test gate.
if ! python3 -c "import libcst" 2>/dev/null; then
  echo "==> Installing libcst..."
  python3 -m pip install --quiet libcst pytest requests --break-system-packages 2>/dev/null \
    || python3 -m pip install --quiet --user libcst pytest requests
fi

{
  echo "Refactron full-pipeline perf bench — $DATE"
  echo "=========================================="
  echo
  echo "Hardware:"
  echo "  $(sysctl -n machdep.cpu.brand_string 2>/dev/null || echo 'unknown CPU') ($(sysctl -n hw.physicalcpu 2>/dev/null || echo '?') physical cores)"
  echo "  $(($(sysctl -n hw.memsize 2>/dev/null || echo 0) / 1024 / 1024 / 1024)) GB RAM"
  echo "  $(uname -srm)"
  if command -v sw_vers > /dev/null; then
    echo "  $(sw_vers -productName) $(sw_vers -productVersion)"
  fi
  echo "  Python: $(python3 --version 2>&1)"
  echo
  echo "Versions:"
  echo "  node: $(node --version)"
  echo "  refactron: $(node -e "console.log(require('./package.json').version)")"
  echo
  echo "Fixture: fixtures/python-legacy-mini"
  local_files=$(find fixtures/python-legacy-mini -type f -name '*.py' | wc -l | tr -d ' ')
  local_loc=$(find fixtures/python-legacy-mini -name '*.py' -exec wc -l {} + 2>/dev/null | tail -1 | awk '{print $1}')
  echo "  Files: $local_files  LOC: $local_loc  (real codebase with pytest suite)"
  echo
  echo "Methodology:"
  echo "  1 warm-up run per command (discarded), then $ITERATIONS measured runs."
  echo "  Wall-clock seconds via /usr/bin/time -p."
  echo "  Fresh fixture copy per iteration (apply mutates the tree)."
  echo "  Report: median (middle), min, max."
  echo
} > "$OUT"

# Helper: run one command N times against a freshly copied fixture.
# Args: $1 = label, $2 = "command args" (relative to fixture dir)
bench_cmd() {
  local label="$1"
  local cmd="$2"
  local mutates="${3:-no}"  # set to "yes" if the command writes; copies the fixture per iteration

  echo "==> Warming up '$label'..."
  local warmup_dir
  local slug
  slug=$(echo "$label" | tr -c '[:alnum:]' '-' | tr -s '-')
  warmup_dir=$(mktemp -d -t "bench-warmup-${slug}-XXXXXX")
  cp -R fixtures/python-legacy-mini/. "$warmup_dir/"
  ( cd "$warmup_dir" && REFACTRON_TOKEN=dummy node "$OLDPWD/dist/cli/index.js" $cmd > /dev/null 2>&1 ) || true
  rm -rf "$warmup_dir"

  echo "==> '$label' — $ITERATIONS measured runs..."
  local times=()
  for i in $(seq 1 "$ITERATIONS"); do
    local dir
    dir=$(mktemp -d -t "bench-${slug}-XXXXXX")
    cp -R fixtures/python-legacy-mini/. "$dir/"
    local elapsed
    elapsed=$( { /usr/bin/time -p sh -c "cd '$dir' && REFACTRON_TOKEN=dummy node '$PWD/dist/cli/index.js' $cmd > /dev/null 2>&1"; } 2>&1 | awk '/^real/{print $2}')
    times+=("$elapsed")
    echo "    run $i: ${elapsed}s"
    rm -rf "$dir"
  done

  local sorted mid_idx median min max
  sorted=$(printf '%s\n' "${times[@]}" | sort -n)
  mid_idx=$(( (ITERATIONS + 1) / 2 ))
  median=$(echo "$sorted" | sed -n "${mid_idx}p")
  min=$(echo "$sorted" | head -1)
  max=$(echo "$sorted" | tail -1)

  {
    echo "Step: $label"
    echo "  Runs: ${times[*]}"
    echo "  Median: ${median}s   Min: ${min}s   Max: ${max}s"
    echo
  } >> "$OUT"
}

bench_cmd "analyze"          "analyze ."                    no
bench_cmd "run --dry-run"    "run --dry-run ."              no
bench_cmd "run --apply"      "run --apply ."                yes

echo
echo "==> Pipeline results saved to $OUT"
echo
cat "$OUT"
