# jscodeshift invocation

```
npx jscodeshift \
    -t bench/comparison/codemods/jscodeshift/var-to-const-let.js \
    --extensions=ts \
    --parser=ts \
    <fixture-dir>
```

The harness invokes jscodeshift through its installed binary in
`bench/comparison/codemods/jscodeshift/node_modules/.bin/jscodeshift` (a local
install — does not pollute global). One transform per file; cold-start each
run.

`format_to_fstring` is **N/A** for jscodeshift — it's a JavaScript codemod
framework with no Python parser.
