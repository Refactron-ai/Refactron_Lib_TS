# LibCST invocation

```
python3 bench/comparison/codemods/libcst/format-to-fstring.py <fixture-dir>
```

The runner imports `libcst.codemod.commands.convert_format_to_fstring.ConvertFormatStringCommand`
— Instagram's reference codemod. We add zero custom logic on top: this is the
"stock LibCST" cell.

`var_to_const_let` is **N/A** for LibCST — it's a Python-only library.

## Known stock behavior

The reference command:
- Rewrites `"...".format(...)` calls (positional and some keyword forms).
- Does **not** rewrite `%`-formatting at all — that's a separate codemod
  Instagram never released publicly. This is the expected `missed` profile.
