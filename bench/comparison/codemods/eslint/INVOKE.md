# ESLint invocation

```
npx eslint -c bench/comparison/codemods/eslint/eslint.config.mjs \
    --fix \
    "<fixture-dir>/**/*.ts"
```

(ESLint v9+ uses flat config exclusively; `--no-eslintrc` and `--ext` were
removed. The config explicitly ignores `node_modules` and `tests/`.)

ESLint's `prefer-const` + `no-var` together perform exactly the var->const/let
rewrite. Zero custom code; this is the "stock tool" cell.

`format_to_fstring` is **N/A** for ESLint — Python is out of scope.
