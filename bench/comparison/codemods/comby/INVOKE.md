# Comby invocation

For `var -> let` (TypeScript):
```
comby -config bench/comparison/codemods/comby/var-to-const-let.toml \
      -in-place -directory <fixture-dir> -extensions ts
```

For `format -> f-string` (Python):
```
comby -config bench/comparison/codemods/comby/format-to-fstring.toml \
      -in-place -directory <fixture-dir> -extensions py
```

## Honest limitations recorded inline in the .toml files

- `var-to-const-let.toml` rewrites *every* `var` to `let`. Comby has no scope
  analysis, so it cannot distinguish reassigned (`let`) from constant (`const`)
  bindings. This produces a high `wrong` count vs the expected `const` cells —
  that's the data.
- `format-to-fstring.toml` handles only the simplest `"...".format(name)` and
  `"...%s..." % name` shapes. Anything with multiple placeholders, format
  specs, or non-literal arguments is out of reach for a regex/structural
  template. Skipped sites count as `missed`.
