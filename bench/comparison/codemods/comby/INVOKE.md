# Comby invocation

For `var -> let` (TypeScript):
```
comby 'var :[name] :[rest]' 'let :[name] :[rest]' .ts \
      -in-place -directory <fixture-dir> -depth 1
```

For `format -> f-string` (Python), two passes:
```
comby '":[before]{}:[after]".format(:[arg])' 'f":[before]{:[arg]}:[after]"' .py \
      -in-place -directory <fixture-dir> -depth 1
comby '":[before]%s:[after]" % :[arg]' 'f":[before]{:[arg]}:[after]"' .py \
      -in-place -directory <fixture-dir> -depth 1
```

The `.toml` files in this directory document the same rules as Comby
templates, but Comby's CLI does not accept `-config` *without* positional
template args, so the harness uses the inline form. The behavior is
identical.

## Honest limitations recorded inline in the .toml files

- `var-to-const-let.toml` rewrites *every* `var` to `let`. Comby has no scope
  analysis, so it cannot distinguish reassigned (`let`) from constant (`const`)
  bindings. This produces a high `wrong` count vs the expected `const` cells —
  that's the data.
- `format-to-fstring.toml` handles only the simplest `"...".format(name)` and
  `"...%s..." % name` shapes. Anything with multiple placeholders, format
  specs, or non-literal arguments is out of reach for a regex/structural
  template. Skipped sites count as `missed`.
