#!/usr/bin/env bash
# bench/run-bench.sh
# Reproducible perf benchmark for Refactron's analyze step.
# Generates the requested fixture sizes fresh, runs N timed iterations,
# and saves median + min + max to bench/results-<DATE>.txt.
#
# Methodology:
#   1. One warm-up run per size (discarded — primes Node's module cache,
#      tree-sitter wasm load, OS file cache).
#   2. N=5 measured runs per size (default), captured via /usr/bin/time -p.
#   3. Report median (3rd of 5), min, max wall-clock seconds.
#   4. Hardware + Node version recorded at the top of the results file.

set -euo pipefail
cd "$(dirname "$0")/.."

# Default sizes; override with: SIZES="10000 100000" ./bench/run-bench.sh
SIZES="${SIZES:-10000 100000}"
ITERATIONS="${ITERATIONS:-5}"
DATE="$(date +%Y-%m-%d)"
OUT="bench/results-${DATE}.txt"

echo "==> Building dist/ (if stale)..."
npm run build > /dev/null 2>&1

{
  echo "Refactron analyze perf bench — $DATE"
  echo "===================================="
  echo
  echo "Hardware:"
  echo "  $(sysctl -n machdep.cpu.brand_string 2>/dev/null || echo 'unknown CPU') ($(sysctl -n hw.physicalcpu 2>/dev/null || echo '?') physical cores)"
  echo "  $(($(sysctl -n hw.memsize 2>/dev/null || echo 0) / 1024 / 1024 / 1024)) GB RAM"
  echo "  $(uname -srm)"
  if command -v sw_vers > /dev/null; then
    echo "  $(sw_vers -productName) $(sw_vers -productVersion)"
  fi
  echo
  echo "Versions:"
  echo "  node: $(node --version)"
  echo "  npm: $(npm --version)"
  echo "  refactron: $(node -e "console.log(require('./package.json').version)")"
  echo
  echo "Methodology:"
  echo "  1 warm-up run (discarded), then $ITERATIONS measured runs per size."
  echo "  Wall-clock seconds via /usr/bin/time -p."
  echo "  Report: median (middle), min, max."
  echo
} > "$OUT"

run_one() {
  local size="$1"
  local dir="bench/${size}-loc"

  echo "==> Generating $size-LOC fixture..."
  npx tsx bench/gen-fixture.ts "$size" "$dir" > /dev/null

  echo "==> Warming up..."
  REFACTRON_TOKEN=dummy node dist/cli/index.js analyze "$dir" > /dev/null 2>&1 || true

  echo "==> Running $ITERATIONS measured iterations..."
  local times=()
  for i in $(seq 1 "$ITERATIONS"); do
    local elapsed
    # Discard analyze's stdout. time -p writes "real X.XX" to stderr; merge
    # it onto stdout (after analyze's stdout is silenced) so awk can parse it.
    elapsed=$( { /usr/bin/time -p env REFACTRON_TOKEN=dummy node dist/cli/index.js analyze "$dir" > /dev/null; } 2>&1 | awk '/^real/{print $2}')
    times+=("$elapsed")
    echo "    run $i: ${elapsed}s"
  done

  # Compute median, min, max.
  local sorted
  sorted=$(printf '%s\n' "${times[@]}" | sort -n)
  local mid_idx=$(( (ITERATIONS + 1) / 2 ))
  local median min max
  median=$(echo "$sorted" | sed -n "${mid_idx}p")
  min=$(echo "$sorted" | head -1)
  max=$(echo "$sorted" | tail -1)

  # File count.
  local files
  files=$(find "$dir" -type f \( -name '*.py' -o -name '*.ts' \) | wc -l | tr -d ' ')

  {
    echo "Size: $size LOC ($files files)"
    echo "  Runs: ${times[*]}"
    echo "  Median: ${median}s   Min: ${min}s   Max: ${max}s"
    echo
  } >> "$OUT"

  echo "==> Cleaning up..."
  rm -rf "$dir"
}

for size in $SIZES; do
  run_one "$size"
done

echo
echo "==> Results saved to $OUT"
echo
cat "$OUT"
