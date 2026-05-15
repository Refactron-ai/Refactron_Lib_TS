# Refactron invocation

Refactron's transforms ship in the CLI itself (`dist/cli/index.js`, v0.2.0).
The harness invokes them via:

```
REFACTRON_TOKEN=dummy node dist/cli/index.js run --apply \
    --transforms=var_to_const_let <fixture-dir>     # TS
REFACTRON_TOKEN=dummy node dist/cli/index.js run --apply \
    --transforms=format_to_fstring <fixture-dir>    # PY
```

`REFACTRON_TOKEN=dummy` short-circuits auth (this is the standard pattern used
in `bench/run-bench.sh`).

Refactron writes through the atomic-writer (temp file -> rename), so partial
writes never occur even if the process is killed mid-run.
