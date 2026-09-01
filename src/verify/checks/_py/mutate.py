#!/usr/bin/env python3
"""Emit operator mutants for the changed lines of one Python file (ADR-15, #116).

stdin:  one JSON object {"path": str, "changed_lines": [int, ...]}
stdout: JSON list of {"line", "col", "endCol", "orig", "repl", "op"}, one per
        mutable operator token found on a changed line.

Tokenize, not regex or AST: token boundaries are exact, string and comment
contents are separate token types and so are never mutated, and the operator's
own position is what a swap needs (AST gives operand positions, not the operator).
A mutant that turns out syntactically invalid is the runner's problem, not ours:
it simply runs and is classified as killed, which is the fail-safe direction.
"""
import io
import json
import sys
import tokenize

# One replacement per operator. Boundary, arithmetic, boolean — the classes that
# catch real regressions per unit of runtime (ADR-15).
OP_SWAP = {
    "<=": "<",
    "<": "<=",
    ">=": ">",
    ">": ">=",
    "==": "!=",
    "!=": "==",
    "+": "-",
    "-": "+",
    "*": "/",
    "/": "*",
    "//": "/",
}
NAME_SWAP = {"and": "or", "or": "and"}


def mutants(source: str, changed: set) -> list:
    out = []
    try:
        toks = tokenize.generate_tokens(io.StringIO(source).readline)
        for tok in toks:
            (row, col) = tok.start
            (erow, ecol) = tok.end
            if row not in changed or row != erow:
                continue
            if tok.type == tokenize.OP and tok.string in OP_SWAP:
                repl = OP_SWAP[tok.string]
            elif tok.type == tokenize.NAME and tok.string in NAME_SWAP:
                repl = NAME_SWAP[tok.string]
            else:
                continue
            out.append(
                {
                    "line": row,
                    "col": col,
                    "endCol": ecol,
                    "orig": tok.string,
                    "repl": repl,
                    "op": tok.string + "->" + repl,
                }
            )
    except (tokenize.TokenError, IndentationError, SyntaxError):
        # A file we cannot tokenize yields no mutants rather than crashing the
        # run. Mutation is opt-in evidence; its absence never grants SAFE.
        return []
    return out


def main() -> int:
    try:
        req = json.load(sys.stdin)
        path = req["path"]
        changed = set(int(x) for x in req.get("changed_lines", []))
    except (json.JSONDecodeError, KeyError, ValueError, TypeError):
        sys.stderr.write("mutate.py: bad request\n")
        return 2
    try:
        with open(path, "r", encoding="utf-8") as fh:
            source = fh.read()
    except OSError as e:
        sys.stderr.write("mutate.py: cannot read %s: %s\n" % (path, e))
        return 2
    json.dump(mutants(source, changed), sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
