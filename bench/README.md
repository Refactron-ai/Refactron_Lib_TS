# bench/

Synthetic fixture generator for the Week 7 perf bench.

The generated trees are NOT committed (they're large and easy to regenerate).
Run the generator locally before benchmarking.

## Usage

```bash
# Generate a synthetic 10k-LOC fixture mixing Python + TypeScript files
# sprinkled with every Refactron transform pattern.
npx tsx bench/gen-fixture.ts 10000 bench/10k-loc

# Run analyze and time it.
time REFACTRON_TOKEN=dummy node dist/cli/index.js analyze bench/10k-loc

# Cleanup
rm -rf bench/10k-loc
```

## Targets (Week 7 binary gate)

| Tree size | Target |
|---|---|
| 10k LOC | < 6s for `analyze` |
| 100k LOC | < 60s for `analyze` |
| 500k LOC | < 5min for `analyze` |
| 100k LOC + run --apply | < 5min including test gate |

The 500k tree generation requires ~25 MB of disk and ~30s wall-clock on a
modern dev machine. Skip it on CI; run locally before release.

## Most recent results

See `dev-docs/decisions/09-week-7-architecture.md` for benchmark snapshots.
