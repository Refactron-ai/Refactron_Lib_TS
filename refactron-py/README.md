# refactron (Python wrapper)

This is a thin Python wrapper around the [npm `refactron` package](https://npmjs.com/package/refactron).
It exists so users with a Python-first toolchain can `pip install refactron`
and get the CLI on their PATH without manually installing Node.

## Install

```bash
pip install refactron
```

Requires Node.js 18+ on your PATH. If `refactron` isn't already installed
via npm, this wrapper will run `npm install -g refactron` on first use.

## Usage

Identical to the npm package:

```bash
refactron analyze .
refactron run --apply
refactron document --apply
```

Full docs: https://docs.refactron.dev
